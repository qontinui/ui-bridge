/**
 * networkProbe client tests.
 *
 * The loopback-only gate lives server-side. This file verifies the client
 * correctly forwards the request body and unwraps the response envelope,
 * and that it surfaces the server's 400 when a non-loopback URL is rejected.
 */

import { describe, it, expect, vi } from 'vitest';
import { networkProbe } from '../network-probe';

describe('networkProbe()', () => {
  it('forwards request body and unwraps 200 envelope', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        success: true,
        data: {
          ok: true,
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: '{"registered": []}',
          elapsedMs: 12,
        },
      }),
    });

    const result = await networkProbe(
      {
        url: 'http://127.0.0.1:9876/ui-bridge/apps/registered',
        method: 'GET',
        timeoutMs: 2000,
      },
      { baseUrl: 'http://localhost:9876', fetchImpl: fetchImpl as typeof fetch }
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toBe('{"registered": []}');
    expect(result.elapsedMs).toBe(12);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:9876/ui-bridge/ai/network-probe');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.url).toBe('http://127.0.0.1:9876/ui-bridge/apps/registered');
    expect(body.method).toBe('GET');
    expect(body.timeoutMs).toBe(2000);
  });

  it('surfaces the server loopback-only rejection as an error', async () => {
    // The runner's handler returns 400 with a clear message when the URL
    // is outside the loopback allow-list. The client wraps that in a
    // thrown Error so tests see the rejection cleanly.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () =>
        "host 'example.com' is not loopback — only 127.0.0.1 / ::1 / localhost / *.local are allowed",
      json: async () => ({ success: false, error: 'non-loopback' }),
    });

    await expect(
      networkProbe(
        { url: 'http://example.com/', method: 'GET' },
        { fetchImpl: fetchImpl as typeof fetch }
      )
    ).rejects.toThrow(/not loopback/);
  });

  it('surfaces the target-server failure as { ok: false, error }', async () => {
    // When the probe reaches the runner but the probed backend is
    // unreachable, the runner returns success: true with data.ok: false.
    // The client should surface that as a result, not an Error.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        success: true,
        data: {
          ok: false,
          elapsedMs: 5,
          error: 'request failed: connection refused',
        },
      }),
    });

    const result = await networkProbe(
      { url: 'http://127.0.0.1:65535/nope' },
      { fetchImpl: fetchImpl as typeof fetch }
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/connection refused/);
  });
});
