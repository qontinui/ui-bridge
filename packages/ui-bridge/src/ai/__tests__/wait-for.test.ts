/**
 * waitFor client tests.
 *
 * Verifies the thin SDK wrapper POSTs the expected body and correctly
 * unwraps the server's envelope — including the `elementValue` success path.
 */

import { describe, it, expect, vi } from 'vitest';
import { waitFor } from '../wait-for';

describe('waitFor()', () => {
  it('elementValue: satisfied once the predicate matches', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        success: true,
        data: { satisfied: true, elapsedMs: 142 },
      }),
    });

    const result = await waitFor(
      { type: 'elementValue', id: 'input-eg-7000', equals: '5000' },
      1000,
      { baseUrl: 'http://localhost:9876', fetchImpl: fetchImpl as typeof fetch }
    );

    expect(result.satisfied).toBe(true);
    expect(result.elapsedMs).toBe(142);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:9876/ui-bridge/ai/wait-for');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.predicate).toEqual({
      type: 'elementValue',
      id: 'input-eg-7000',
      equals: '5000',
    });
    expect(body.timeoutMs).toBe(1000);
  });

  it('textVisible: unsatisfied + timedOut preserves lastError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        success: true,
        data: {
          satisfied: false,
          elapsedMs: 3000,
          timedOut: true,
          lastError: 'SDK not connected',
        },
      }),
    });

    const result = await waitFor({ type: 'textVisible', text: 'Registered' }, 3000, {
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.satisfied).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.lastError).toBe('SDK not connected');
  });

  it('throws when the runner returns a non-2xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => 'timeoutMs exceeds ceiling',
      json: async () => ({ success: false, error: 'nope' }),
    });

    await expect(
      waitFor({ type: 'textVisible', text: 'x' }, 60_000, { fetchImpl: fetchImpl as typeof fetch })
    ).rejects.toThrow(/HTTP 400/);
  });

  it('throws when envelope reports success: false', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ success: false, error: 'something broke' }),
    });
    await expect(
      waitFor({ type: 'elementVisible', id: 'foo' }, 1000, {
        fetchImpl: fetchImpl as typeof fetch,
      })
    ).rejects.toThrow(/something broke/);
  });
});
