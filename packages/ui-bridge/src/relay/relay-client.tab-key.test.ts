/**
 * The pinned tab key on the relay wire (relay-binding Phase 2b).
 *
 * `X-UI-Bridge-Tab-Key` is a credential for the LOCAL runner: it rides on the
 * stream GET, result POST and heartbeat to a loopback `basePath` only, never
 * to a remote SDK relay. And a document with an opaque origin (the injector's
 * pre-`goto` `about:blank`) sends nothing at all, because the runner refuses
 * it and the navigation is about to replace it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startRelayClient, isLoopbackBase } from './relay-client';

type Call = { url: string; method: string; headers: Record<string, string> };

type InjectedWindow = typeof globalThis & {
  __uiBridgeInjectedConfig?: { tabId?: string; tabKey?: string };
};

const KEY = 'k'.repeat(43);

describe('relay client · tab key', () => {
  let calls: Call[];
  let stop: (() => void) | null;

  beforeEach(() => {
    calls = [];
    stop = null;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      if (url.includes('/commands/stream')) {
        // One command frame, then hold the stream open.
        const frame = `data: ${JSON.stringify({ commandId: 'c1', action: 'ping', payload: {} })}

`;
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode(frame));
          },
        });
        return new Response(body, { status: 200 });
      }
      return new Response(JSON.stringify({ tabRegistered: true }), { status: 200 });
    }) as unknown as typeof fetch;
    (window as InjectedWindow).__uiBridgeInjectedConfig = { tabId: 't1', tabKey: KEY };
  });

  afterEach(() => {
    stop?.();
    delete (window as InjectedWindow).__uiBridgeInjectedConfig;
    vi.restoreAllMocks();
  });

  async function start(basePath: string, execute = async () => ({ ok: true })) {
    const client = startRelayClient({ basePath, execute, tabId: 't1' });
    stop = () => client.stop();
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
  }

  it('sends the key on the stream GET, result POST and heartbeat to the loopback runner', async () => {
    await start('http://127.0.0.1:9876/ui-bridge');
    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith('/commands'))).toBe(true));
    const stream = calls.find((c) => c.url.includes('/commands/stream'));
    const result = calls.find((c) => c.url.endsWith('/commands') && c.method === 'POST');
    const beat = calls.find((c) => c.url.endsWith('/heartbeat'));
    expect(stream?.headers['X-UI-Bridge-Tab-Key']).toBe(KEY);
    expect(result?.headers['X-UI-Bridge-Tab-Key']).toBe(KEY);
    expect(beat?.headers['X-UI-Bridge-Tab-Key']).toBe(KEY);
  });

  it('never sends the key to a remote SDK relay', async () => {
    await start('https://qontinui.io/api/ui-bridge');
    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith('/commands'))).toBe(true));
    for (const c of calls) expect(c.headers).not.toHaveProperty('X-UI-Bridge-Tab-Key');
  });

  it('sends nothing without an injected key', async () => {
    (window as InjectedWindow).__uiBridgeInjectedConfig = { tabId: 't1' };
    await start('http://127.0.0.1:9876/ui-bridge');
    for (const c of calls) expect(c.headers).not.toHaveProperty('X-UI-Bridge-Tab-Key');
  });

  it('sends no relay request from an opaque-origin document', async () => {
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      origin: 'null',
      href: 'about:blank',
    } as Location);
    const client = startRelayClient({
      basePath: 'http://127.0.0.1:9876/ui-bridge',
      execute: async () => ({}),
      tabId: 't1',
    });
    stop = () => client.stop();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual([]);
  });
});

describe('isLoopbackBase', () => {
  it('accepts the three loopback spellings', () => {
    expect(isLoopbackBase('http://127.0.0.1:9876/ui-bridge')).toBe(true);
    expect(isLoopbackBase('http://localhost:9876/ui-bridge')).toBe(true);
    expect(isLoopbackBase('http://[::1]:9876/ui-bridge')).toBe(true);
  });

  it('rejects a remote relay and a loopback-looking subdomain', () => {
    expect(isLoopbackBase('https://qontinui.io/api/ui-bridge')).toBe(false);
    expect(isLoopbackBase('http://localhost.evil.example/ui-bridge')).toBe(false);
  });

  it('resolves a relative base against this document', () => {
    // jsdom's document is http://localhost:3000/ in this suite's config.
    expect(isLoopbackBase('/api/ui-bridge')).toBe(
      ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
    );
  });
});
