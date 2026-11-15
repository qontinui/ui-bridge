/**
 * A relay tab's result POST, end to end through `startRelayClient`.
 *
 * A command arrives on a stub command stream; the tab executes it and POSTs
 * the result to `{basePath}/commands`, whose answers are scripted here. Fake
 * timers drive every wait, so the spacing between POSTs is the wait the client
 * chose. Before the fix the client POSTed once and never read the answer: a
 * 429/403/404/413/5xx vanished without an `onError`, and a retryable refusal
 * was never retried.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startRelayClient } from './relay-client';

/** A stream we can push SSE frames into by hand. */
function controllableStream(): {
  body: { getReader: () => ReadableStreamDefaultReader<Uint8Array> };
  push: (frame: string) => void;
} {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    body: { getReader: () => stream.getReader() },
    push: (frame: string) => controller.enqueue(new TextEncoder().encode(frame)),
  };
}

type Scripted = { status: number; body?: string; retryAfter?: string } | { networkError: true };

function fakeResponse(s: { status: number; body?: string; retryAfter?: string }): Response {
  const headers = new Headers();
  if (s.retryAfter !== undefined) headers.set('Retry-After', s.retryAfter);
  const body = s.body ?? '';
  return {
    ok: s.status >= 200 && s.status < 300,
    status: s.status,
    headers,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(body ? JSON.parse(body) : {}),
  } as unknown as Response;
}

const START = Date.parse('2026-11-08T12:00:00Z');
const rateLimited = JSON.stringify({
  success: false,
  code: 'TRANSPORT_RATE_LIMITED',
  lane: 'result',
});

describe('relay client · result POST reads its answer', () => {
  let stream: ReturnType<typeof controllableStream>;
  let resultPosts: number[];
  let script: Scripted[];
  let errors: string[];
  let stop: (() => void) | null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(START));
    stream = controllableStream();
    resultPosts = [];
    script = [];
    errors = [];
    stop = null;
    vi.stubGlobal('fetch', (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/commands/stream')) {
        return Promise.resolve({ ok: true, body: stream.body } as unknown as Response);
      }
      if (url.includes('/heartbeat')) {
        return Promise.resolve(fakeResponse({ status: 200, body: '{"tabRegistered":true}' }));
      }
      if (url.endsWith('/commands') && init?.method === 'POST') {
        const s = script[Math.min(resultPosts.length, script.length - 1)];
        resultPosts.push(Date.now());
        if ('networkError' in s) return Promise.reject(new TypeError('Failed to fetch'));
        return Promise.resolve(fakeResponse(s));
      }
      return Promise.resolve(fakeResponse({ status: 200 }));
    });
  });

  afterEach(() => {
    stop?.();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** Boot the client, deliver one command, and run the clock forward 20 s. */
  async function runOneCommand(answers: Scripted[]): Promise<void> {
    script = answers;
    const client = startRelayClient({
      basePath: '/api/ui-bridge',
      execute: async () => ({ success: true, value: 1 }),
      heartbeatIntervalMs: 10_000,
      onError: (message) => errors.push(message),
    });
    stop = () => client.stop();
    await vi.advanceTimersByTimeAsync(0);
    stream.push(`data: ${JSON.stringify({ type: 'connected', streamId: 's-1' })}\n\n`);
    stream.push(
      `data: ${JSON.stringify({ commandId: 'cmd-1', action: 'getElement', payload: {} })}\n\n`
    );
    await vi.advanceTimersByTimeAsync(20_000);
  }

  it('(a) stop() during a 429 Retry-After: 2 wait -> one POST, no onError, no timers left', async () => {
    script = [{ status: 429, retryAfter: '2', body: rateLimited }, { status: 200 }];
    const client = startRelayClient({
      basePath: '/api/ui-bridge',
      execute: async () => ({ success: true, value: 1 }),
      heartbeatIntervalMs: 10_000,
      onError: (message) => errors.push(message),
    });
    stop = () => client.stop();
    await vi.advanceTimersByTimeAsync(0);
    stream.push(`data: ${JSON.stringify({ type: 'connected', streamId: 's-1' })}\n\n`);
    stream.push(
      `data: ${JSON.stringify({ commandId: 'cmd-1', action: 'getElement', payload: {} })}\n\n`
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(resultPosts).toHaveLength(1);
    client.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(resultPosts).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it('(1) 429 Retry-After: 1 then 200 -> two POSTs >= 1000 ms apart, no onError', async () => {
    await runOneCommand([{ status: 429, retryAfter: '1', body: rateLimited }, { status: 200 }]);
    expect(resultPosts).toHaveLength(2);
    expect(resultPosts[1] - resultPosts[0]).toBeGreaterThanOrEqual(1000);
    expect(errors).toEqual([]);
  });

  it('(2) three 429s -> three POSTs, then one onError naming 429, code and lane', async () => {
    await runOneCommand([
      { status: 429, body: rateLimited },
      { status: 429, body: rateLimited },
      { status: 429, body: rateLimited },
    ]);
    expect(resultPosts).toHaveLength(3);
    expect(resultPosts.map((t) => t - resultPosts[0])).toEqual([0, 1000, 3000]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('429');
    expect(errors[0]).toContain('TRANSPORT_RATE_LIMITED');
    expect(errors[0]).toContain('lane result');
    expect(errors[0]).toContain('cmd-1');
  });

  it('(3) 403 COMMAND_RESPONSE_REFUSED -> one POST, one onError', async () => {
    await runOneCommand([
      { status: 403, body: JSON.stringify({ success: false, code: 'COMMAND_RESPONSE_REFUSED' }) },
    ]);
    expect(resultPosts).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('403');
    expect(errors[0]).toContain('COMMAND_RESPONSE_REFUSED');
  });

  it('(4) 404 COMMAND_UNKNOWN -> one POST, one onError', async () => {
    await runOneCommand([
      { status: 404, body: JSON.stringify({ success: false, code: 'COMMAND_UNKNOWN' }) },
    ]);
    expect(resultPosts).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('404');
    expect(errors[0]).toContain('COMMAND_UNKNOWN');
  });

  it('(5) 413 -> one POST, one onError', async () => {
    await runOneCommand([{ status: 413, body: 'Payload Too Large' }]);
    expect(resultPosts).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('413');
  });

  it('(6) network error then 200 -> two POSTs, no onError', async () => {
    await runOneCommand([{ networkError: true }, { status: 200 }]);
    expect(resultPosts).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  it('(7) 503 with Retry-After as an HTTP-date 2 s ahead -> waits 2000 ms', async () => {
    await runOneCommand([
      { status: 503, retryAfter: new Date(START + 2000).toUTCString() },
      { status: 200 },
    ]);
    expect(resultPosts).toHaveLength(2);
    expect(resultPosts[1] - resultPosts[0]).toBe(2000);
    expect(errors).toEqual([]);
  });

  it('(8) Retry-After: 60 then 200 -> waits exactly 5000 ms (the clamp)', async () => {
    await runOneCommand([{ status: 429, retryAfter: '60' }, { status: 200 }]);
    expect(resultPosts).toHaveLength(2);
    expect(resultPosts[1] - resultPosts[0]).toBe(5000);
    expect(errors).toEqual([]);
  });

  it('(9) 200 -> one POST, no onError (control)', async () => {
    await runOneCommand([{ status: 200 }]);
    expect(resultPosts).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it('(10) three 429s each Retry-After: 5 -> two POSTs (6000 ms budget), one onError', async () => {
    await runOneCommand([
      { status: 429, retryAfter: '5', body: rateLimited },
      { status: 429, retryAfter: '5', body: rateLimited },
      { status: 429, retryAfter: '5', body: rateLimited },
    ]);
    expect(resultPosts).toHaveLength(2);
    expect(resultPosts[1] - resultPosts[0]).toBe(5000);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('429');
  });
});
