import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import {
  ConsoleErrorBuffer,
  NetworkRequestBuffer,
  NativeUIBridgeServer,
} from '../index';
import type {
  ConsoleErrorsResponse,
  NetworkRequestsResponse,
} from '../types';
import type { ServerAdapter, RequestHandler } from '../http-server';

/**
 * Coverage for `GET /ui-bridge/control/console-errors` and
 * `GET /ui-bridge/sdk/network-requests`.
 *
 * The endpoints are fed by ring buffers (`ConsoleErrorBuffer`,
 * `NetworkRequestBuffer`) that monkey-patch `console.error` / `console.warn`
 * and global `fetch` respectively. The server installs them on `start()` when
 * `testHooks: true`, and uninstalls on `stop()`.
 *
 * Tests both the buffer classes directly (so the patches don't bleed across
 * test cases) and the end-to-end path through `handleRequest`.
 */

interface ParsedResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  timestamp: number;
}

/** Stub server adapter that records start/stop calls but doesn't bind a port. */
function makeStubAdapter(): ServerAdapter & {
  startCount: number;
  stopCount: number;
  lastHandler: RequestHandler | null;
} {
  const adapter: ServerAdapter & {
    startCount: number;
    stopCount: number;
    lastHandler: RequestHandler | null;
  } = {
    startCount: 0,
    stopCount: 0,
    lastHandler: null,
    async start(_port, handler) {
      this.startCount++;
      this.lastHandler = handler;
    },
    async stop() {
      this.stopCount++;
    },
    isRunning() {
      return this.startCount > this.stopCount;
    },
  };
  return adapter;
}

// ── ConsoleErrorBuffer ──────────────────────────────────────────────────────

describe('ConsoleErrorBuffer', () => {
  let buf: ConsoleErrorBuffer;

  beforeEach(() => {
    buf = new ConsoleErrorBuffer(5);
  });

  afterEach(() => {
    buf.uninstall();
  });

  it('captures console.error calls', () => {
    buf.install();
    console.error('boom', { detail: 1 });
    const entries = buf.entries();
    expect(entries.length).toBe(1);
    expect(entries[0].level).toBe('error');
    expect(entries[0].message).toContain('boom');
    expect(entries[0].timestamp).toBeGreaterThan(0);
  });

  it('captures console.warn calls', () => {
    buf.install();
    console.warn('careful');
    const entries = buf.entries();
    expect(entries.length).toBe(1);
    expect(entries[0].level).toBe('warn');
    expect(entries[0].message).toContain('careful');
  });

  it('captures the stack from Error arguments', () => {
    buf.install();
    const err = new Error('with stack');
    console.error(err);
    const entries = buf.entries();
    expect(entries[0].stack).toBeDefined();
    expect(entries[0].stack).toContain('with stack');
  });

  it('drops the oldest entry on overflow', () => {
    buf.install();
    for (let i = 0; i < 7; i++) {
      console.error(`entry ${i}`);
    }
    const entries = buf.entries();
    expect(entries.length).toBe(5);
    expect(entries[0].message).toContain('entry 2');
    expect(entries[4].message).toContain('entry 6');
  });

  it('filters by `since`', () => {
    buf.install();
    console.error('first');
    const cutoff = Date.now() + 1;
    // Force a small delay so the second entry's timestamp clears `cutoff`.
    vi.useFakeTimers();
    vi.setSystemTime(cutoff + 5);
    console.error('second');
    vi.useRealTimers();

    const entries = buf.entries({ since: cutoff });
    expect(entries.length).toBe(1);
    expect(entries[0].message).toContain('second');
  });

  it('respects the `limit` parameter (newest entries kept)', () => {
    buf.install();
    for (let i = 0; i < 5; i++) console.error(`m${i}`);
    const entries = buf.entries({ limit: 2 });
    expect(entries.length).toBe(2);
    expect(entries[0].message).toContain('m3');
    expect(entries[1].message).toContain('m4');
  });

  it('uninstall restores the original console.error', () => {
    const original = console.error;
    buf.install();
    expect(console.error).not.toBe(original);
    buf.uninstall();
    expect(console.error).toBe(original);
  });

  it('install is idempotent', () => {
    buf.install();
    const patched = console.error;
    buf.install();
    expect(console.error).toBe(patched);
  });
});

// ── NetworkRequestBuffer ────────────────────────────────────────────────────

describe('NetworkRequestBuffer', () => {
  let buf: NetworkRequestBuffer;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    buf = new NetworkRequestBuffer(5);
  });

  afterEach(() => {
    buf.uninstall();
    globalThis.fetch = originalFetch;
  });

  it('records a successful fetch with status + duration', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('hi', { status: 200 });
    }) as unknown as typeof fetch;

    buf.install();

    const res = await fetch('https://example.test/ok');
    expect(res.status).toBe(200);

    const entries = buf.entries();
    expect(entries.length).toBe(1);
    expect(entries[0].status).toBe(200);
    expect(entries[0].ok).toBe(true);
    expect(entries[0].url).toContain('example.test/ok');
    expect(entries[0].method).toBe('GET');
    expect(typeof entries[0].durationMs).toBe('number');
  });

  it('records a failing fetch with status=0 + ok=false', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    buf.install();

    await expect(fetch('https://example.test/bad')).rejects.toThrow('network down');

    const entries = buf.entries();
    expect(entries.length).toBe(1);
    expect(entries[0].status).toBe(0);
    expect(entries[0].ok).toBe(false);
    expect(entries[0].error).toContain('network down');
  });

  it('captures custom HTTP method from init', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 204 })
    ) as unknown as typeof fetch;
    buf.install();

    await fetch('https://example.test/post', { method: 'post' });

    const entries = buf.entries();
    expect(entries[0].method).toBe('POST');
    expect(entries[0].status).toBe(204);
  });

  it('drops oldest on overflow', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 200 })
    ) as unknown as typeof fetch;
    buf.install();

    for (let i = 0; i < 7; i++) {
      await fetch(`https://example.test/${i}`);
    }
    const entries = buf.entries();
    expect(entries.length).toBe(5);
    expect(entries[0].url).toContain('/2');
    expect(entries[4].url).toContain('/6');
  });

  it('uninstall restores original fetch', async () => {
    const original = globalThis.fetch;
    buf.install();
    expect(globalThis.fetch).not.toBe(original);
    buf.uninstall();
    expect(globalThis.fetch).toBe(original);
  });
});

// ── End-to-end through NativeUIBridgeServer ─────────────────────────────────

describe('NativeUIBridgeServer — observability endpoints', () => {
  let originalFetch: typeof fetch;
  let originalConsoleError: typeof console.error;
  let originalConsoleWarn: typeof console.warn;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalConsoleError = console.error;
    originalConsoleWarn = console.warn;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  });

  it('returns recorded console errors from /control/console-errors when testHooks is on', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const server = new NativeUIBridgeServer(registry, executor, { testHooks: true });

    const adapter = makeStubAdapter();
    server.setAdapter(adapter);
    await server.start();

    // The patch is now active. Call the patched globals directly. The buffer
    // chains through to the original console (which prints to stderr in
    // vitest), so we accept the test-output noise rather than overwriting
    // console.error and breaking the chain.
    console.error('boom');
    console.warn('warn');

    const response = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/control/console-errors',
      headers: {},
      query: {},
    });
    expect(response.status).toBe(200);
    const parsed = JSON.parse(response.body) as ParsedResponse<ConsoleErrorsResponse>;
    expect(parsed.success).toBe(true);
    expect(parsed.data?.entries.length).toBeGreaterThanOrEqual(2);
    const messages = parsed.data?.entries.map((e) => e.message) ?? [];
    expect(messages.some((m) => m.includes('boom'))).toBe(true);
    expect(messages.some((m) => m.includes('warn'))).toBe(true);

    await server.stop();
  });

  it('returns recorded fetch entries from /sdk/network-requests when testHooks is on', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const server = new NativeUIBridgeServer(registry, executor, { testHooks: true });

    const adapter = makeStubAdapter();
    server.setAdapter(adapter);

    // Stub fetch *before* start() so the patched fetch wraps the stub.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.includes('badurl')) {
        throw new Error('connection refused');
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    await server.start();

    await fetch('https://example.test/healthy');
    await fetch('https://example.test/badurl').catch(() => {
      /* expected */
    });

    const response = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/sdk/network-requests',
      headers: {},
      query: {},
    });
    expect(response.status).toBe(200);
    const parsed = JSON.parse(response.body) as ParsedResponse<NetworkRequestsResponse>;
    expect(parsed.success).toBe(true);
    expect(parsed.data?.entries.length).toBe(2);
    const successEntry = parsed.data?.entries.find((e) => e.url.includes('/healthy'));
    const failEntry = parsed.data?.entries.find((e) => e.url.includes('/badurl'));
    expect(successEntry?.status).toBe(200);
    expect(successEntry?.ok).toBe(true);
    expect(failEntry?.status).toBe(0);
    expect(failEntry?.ok).toBe(false);

    await server.stop();
  });

  it('returns a schema-valid 200 (not 404) for /control/console-errors when testHooks is off', async () => {
    // The route is always mounted so agents get a well-formed envelope rather
    // than a 404 they can't distinguish from a missing route. When testHooks
    // is off the console patch isn't installed, so `installed:false` and the
    // buffer is empty — but the contract is still honoured.
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const server = new NativeUIBridgeServer(registry, executor, { testHooks: false });

    const response = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/control/console-errors',
      headers: {},
      query: {},
    });
    expect(response.status).toBe(200);
    const parsed = JSON.parse(response.body) as ParsedResponse<ConsoleErrorsResponse>;
    expect(parsed.success).toBe(true);
    expect(parsed.data?.entries).toEqual([]);
    expect(parsed.data?.count).toBe(0);
    expect(parsed.data?.installed).toBe(false);
  });

  it('returns a schema-valid 200 (not 404) for /sdk/network-requests when testHooks is off', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const server = new NativeUIBridgeServer(registry, executor, { testHooks: false });

    const response = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/sdk/network-requests',
      headers: {},
      query: {},
    });
    expect(response.status).toBe(200);
    const parsed = JSON.parse(response.body) as ParsedResponse<NetworkRequestsResponse>;
    expect(parsed.success).toBe(true);
    expect(parsed.data?.entries).toEqual([]);
    expect(parsed.data?.count).toBe(0);
    expect(parsed.data?.installed).toBe(false);
  });

  it('advertises observability endpoints in /_routes regardless of testHooks', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const server = new NativeUIBridgeServer(registry, executor, { testHooks: false });

    const response = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/_routes',
      headers: {},
      query: {},
    });
    const parsed = JSON.parse(response.body) as {
      data: { routes: Array<{ method: string; path: string }> };
    };
    const paths = parsed.data.routes.map((r) => r.path);
    expect(paths).toContain('/ui-bridge/control/console-errors');
    expect(paths).toContain('/ui-bridge/sdk/network-requests');
  });

  it('does advertise observability endpoints in /_routes when testHooks is on', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const server = new NativeUIBridgeServer(registry, executor, { testHooks: true });

    const response = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/_routes',
      headers: {},
      query: {},
    });
    const parsed = JSON.parse(response.body) as {
      data: { routes: Array<{ method: string; path: string }> };
    };
    const paths = parsed.data.routes.map((r) => r.path);
    expect(paths).toContain('/ui-bridge/control/console-errors');
    expect(paths).toContain('/ui-bridge/sdk/network-requests');
  });

  // ── `observability` flag decoupled from `testHooks` ───────────────────────

  it('installs capture with observability:true even when testHooks is off (installed:true)', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const server = new NativeUIBridgeServer(registry, executor, {
      testHooks: false,
      observability: true,
    });

    const adapter = makeStubAdapter();
    server.setAdapter(adapter);

    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as
      typeof fetch;

    await server.start();

    console.error('release-build boom');
    await fetch('https://example.test/usage');

    const consoleRes = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/control/console-errors',
      headers: {},
      query: {},
    });
    expect(consoleRes.status).toBe(200);
    const consoleParsed = JSON.parse(consoleRes.body) as ParsedResponse<ConsoleErrorsResponse>;
    expect(consoleParsed.success).toBe(true);
    expect(consoleParsed.data?.installed).toBe(true);
    expect(
      consoleParsed.data?.entries.some((e) => e.message.includes('release-build boom'))
    ).toBe(true);

    const networkRes = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/sdk/network-requests',
      headers: {},
      query: {},
    });
    const networkParsed = JSON.parse(networkRes.body) as ParsedResponse<NetworkRequestsResponse>;
    expect(networkParsed.data?.installed).toBe(true);
    expect(networkParsed.data?.entries.some((e) => e.url.includes('/usage'))).toBe(true);

    await server.stop();
  });

  it('does NOT expose testHooks-gated routes when only observability is on', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const server = new NativeUIBridgeServer(registry, executor, {
      testHooks: false,
      observability: true,
    });

    const adapter = makeStubAdapter();
    server.setAdapter(adapter);
    await server.start();

    const response = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/_routes',
      headers: {},
      query: {},
    });
    const parsed = JSON.parse(response.body) as {
      data: { routes: Array<{ method: string; path: string }> };
    };
    const paths = parsed.data.routes.map((r) => r.path);
    // Observability endpoints stay advertised...
    expect(paths).toContain('/ui-bridge/control/console-errors');
    // ...but the testHooks control surface stays hidden.
    expect(paths.some((p) => p.includes('control/modal'))).toBe(false);

    await server.stop();
  });

  it('explicit observability:false disables capture even when testHooks is on', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const server = new NativeUIBridgeServer(registry, executor, {
      testHooks: true,
      observability: false,
    });

    const adapter = makeStubAdapter();
    server.setAdapter(adapter);
    await server.start();

    const response = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/control/console-errors',
      headers: {},
      query: {},
    });
    const parsed = JSON.parse(response.body) as ParsedResponse<ConsoleErrorsResponse>;
    expect(parsed.success).toBe(true);
    expect(parsed.data?.installed).toBe(false);
    expect(parsed.data?.entries).toEqual([]);

    await server.stop();
  });
});
