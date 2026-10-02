/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "http://localhost:3000/"}
 */

/**
 * Phone-home registration in useCommandRelay (plan
 * 2026-09-17-ui-bridge-relay-registration-is-unauthenticated, Phase 1b).
 *
 * Pins two contracts of the phone-home effect:
 *
 *   1. The default `appId` is `location.host` (port-inclusive), so two dev
 *      apps on the same hostname but different ports do not contend for one
 *      runner registry row. `options.appId` still overrides.
 *   2. A runner refusal (HTTP 409 / 403) logs exactly one `console.warn` per
 *      mount naming the runner's refusal code, not one per 10s retry, and
 *      never throws.
 *
 * The relay transport (`startRelayClient`) and the bridge hooks are stubbed:
 * this file exercises only the phone-home effect's fetch traffic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('./useUIBridge', () => ({ useUIBridge: () => ({}) }));
vi.mock('./UIBridgeProvider', () => ({ useUIBridgeOptional: () => null }));
vi.mock('../relay/relay-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../relay/relay-client')>();
  return { ...actual, startRelayClient: () => ({ stop: () => {} }) };
});

import { useCommandRelay } from './useCommandRelay';

const REGISTER_URL = 'http://127.0.0.1:9876/ui-bridge/apps/register';

type FetchMock = ReturnType<typeof vi.fn>;

function registerCalls(fetchMock: FetchMock): Array<Record<string, unknown>> {
  return fetchMock.mock.calls
    .filter(([url, init]) => url === REGISTER_URL && (init as RequestInit)?.method === 'POST')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('useCommandRelay phone-home', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn(async () => jsonResponse(200, { success: true }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders at http://localhost:3000', () => {
    expect(window.location.host).toBe('localhost:3000');
    expect(window.location.hostname).toBe('localhost');
  });

  it('posts the port-inclusive host as the default appId', async () => {
    const { unmount } = renderHook(() => useCommandRelay());
    await vi.advanceTimersByTimeAsync(0);

    const calls = registerCalls(fetchMock);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0].appId).toBe('localhost:3000');
    expect(calls[0].origin).toBe('http://localhost:3000');
    unmount();
  });

  it('deregisters the port-inclusive appId on beforeunload', async () => {
    const { unmount } = renderHook(() => useCommandRelay());
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event('beforeunload'));

    const deletes = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit)?.method === 'DELETE'
    );
    expect(deletes.map(([url]) => url)).toEqual([
      `${REGISTER_URL}/${encodeURIComponent('localhost:3000')}`,
    ]);
    unmount();
  });

  it('lets options.appId override the default', async () => {
    const { unmount } = renderHook(() => useCommandRelay({ appId: 'my-app' }));
    await vi.advanceTimersByTimeAsync(0);

    expect(registerCalls(fetchMock)[0].appId).toBe('my-app');
    unmount();
  });

  it('warns once per mount naming the top-level refusal code on 409', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(409, {
        success: false,
        error: 'registration held by another live app',
        code: 'UIB_REGISTRATION_HELD',
      })
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { unmount } = renderHook(() => useCommandRelay());
    await vi.advanceTimersByTimeAsync(0);
    // Three more 10s retries — each refused, none re-warns.
    await vi.advanceTimersByTimeAsync(30_000);

    expect(registerCalls(fetchMock).length).toBe(4);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('UIB_REGISTRATION_HELD');
    expect(message).toContain('409');
    expect(message).toContain('localhost:3000');
    unmount();
  });

  it('reads a nested error.code on 403', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(403, { success: false, error: { code: 'UIB_ORIGIN_MISMATCH' } })
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { unmount } = renderHook(() => useCommandRelay());
    await vi.advanceTimersByTimeAsync(0);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('UIB_ORIGIN_MISMATCH');
    unmount();
  });

  it('still warns (without a code) when the refusal body is not JSON', async () => {
    fetchMock.mockImplementation(async () => new Response('nope', { status: 409 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { unmount } = renderHook(() => useCommandRelay());
    await vi.advanceTimersByTimeAsync(0);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('409');
    unmount();
  });

  it('does not warn on success or on other error statuses', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockImplementationOnce(async () => jsonResponse(200, { success: true }));
    fetchMock.mockImplementation(async () => jsonResponse(500, { success: false, code: 'X' }));

    const { unmount } = renderHook(() => useCommandRelay());
    await vi.advanceTimersByTimeAsync(10_000);

    expect(registerCalls(fetchMock).length).toBe(2);
    expect(warn).not.toHaveBeenCalled();
    unmount();
  });

  it('warns again on a fresh mount', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(409, { success: false, code: 'UIB_REGISTRATION_HELD' })
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const first = renderHook(() => useCommandRelay());
    await vi.advanceTimersByTimeAsync(0);
    first.unmount();
    const second = renderHook(() => useCommandRelay());
    await vi.advanceTimersByTimeAsync(0);
    second.unmount();

    expect(warn).toHaveBeenCalledTimes(2);
  });
});
