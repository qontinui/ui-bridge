import { describe, it, expect, vi } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import { NativeUIBridgeServer } from '../http-server';
import type { KeepAwakeProvider } from '../types';

/**
 * Routing + behaviour coverage for `POST /ui-bridge/control/keep-awake`.
 *
 * The endpoint is gated by `features.testHooks` (mirrored to
 * `NativeServerConfig.testHooks`). With the gate off the route must be
 * invisible (NOT_FOUND). With the gate on but no `KeepAwakeProvider` wired,
 * the default stub answers `NOT_SUPPORTED` (no crash). With a provider wired
 * via `setKeepAwakeProvider`, the handler validates the body, then forwards
 * to `provider.request` / `provider.release`.
 *
 * Additionally, when test hooks are on and a provider is wired, the auto-arm
 * block at the top of `handleRequest` keeps the screen alive for 60s on every
 * inbound request (single chokepoint for HTTP / WS-tunnelled / cloud-relay).
 *
 * NOTE: because auto-arm runs *before* routing on every request, a wired
 * provider also receives a `request('auto-arm', 60000)` call on the
 * keep-awake POST itself. Validation / happy-path assertions therefore
 * filter the mock's calls by source ('ui-bridge') rather than asserting a
 * raw call count — the auto-arm call is expected, not a regression.
 */

/** Mock calls to `request` originating from the handler (source === 'ui-bridge'). */
function uiBridgeRequestCalls(
  request: ReturnType<typeof vi.fn>
): unknown[][] {
  return request.mock.calls.filter((c) => c[0] === 'ui-bridge');
}

interface ParsedResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  timestamp: number;
}

function buildServer(testHooks = true) {
  const registry = new NativeUIBridgeRegistry();
  const executor = new DefaultNativeActionExecutor(registry);
  const server = new NativeUIBridgeServer(registry, executor, { testHooks });
  return { registry, executor, server };
}

function makeFakeProvider(): KeepAwakeProvider & {
  request: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
} {
  return { request: vi.fn(), release: vi.fn() };
}

function post(server: NativeUIBridgeServer, body: unknown) {
  return server.handleRequest({
    method: 'POST',
    path: '/ui-bridge/control/keep-awake',
    headers: { 'Content-Type': 'application/json' },
    query: {},
    body,
  });
}

describe('POST /ui-bridge/control/keep-awake — routing + behaviour', () => {
  // ── 1. testHooks gating ──────────────────────────────────────────────────
  describe('testHooks gating', () => {
    it('hides the route (NOT_FOUND) when testHooks is off', async () => {
      const { server } = buildServer(false);

      const res = await post(server, { enabled: true });
      expect(res.status).toBe(400);
      const parsed = JSON.parse(res.body) as ParsedResponse<unknown>;
      expect(parsed.success).toBe(false);
      expect(parsed.code).toBe('NOT_FOUND');

      // Manifest excludes the test-hook route too.
      const manifest = await server.handleRequest({
        method: 'GET',
        path: '/ui-bridge/_routes',
        headers: {},
        query: {},
      });
      const manifestParsed = JSON.parse(manifest.body) as {
        data: { routes: Array<{ path: string }> };
      };
      const paths = manifestParsed.data.routes.map((r) => r.path);
      expect(paths).not.toContain('/ui-bridge/control/keep-awake');
    });

    it('exposes the route when testHooks is on', async () => {
      const { server } = buildServer(true);

      const manifest = await server.handleRequest({
        method: 'GET',
        path: '/ui-bridge/_routes',
        headers: {},
        query: {},
      });
      const manifestParsed = JSON.parse(manifest.body) as {
        data: { routes: Array<{ method: string; path: string }> };
      };
      const paths = manifestParsed.data.routes.map((r) => `${r.method} ${r.path}`);
      expect(paths).toContain('POST /ui-bridge/control/keep-awake');
    });
  });

  // ── 2. No provider configured ────────────────────────────────────────────
  it('returns the NOT_SUPPORTED stub when no provider is wired (no crash)', async () => {
    const { server } = buildServer(true);

    const res = await post(server, { enabled: true });
    expect(res.status).toBe(400);
    const parsed = JSON.parse(res.body) as ParsedResponse<unknown>;
    expect(parsed.success).toBe(false);
    expect(parsed.code).toBe('NOT_SUPPORTED');
  });

  // ── 3. Validation ────────────────────────────────────────────────────────
  describe('validation (provider wired)', () => {
    it('rejects an empty body with INVALID_REQUEST and does not call the provider', async () => {
      const { server } = buildServer(true);
      const provider = makeFakeProvider();
      server.setKeepAwakeProvider(provider);

      const res = await post(server, {});
      expect(res.status).toBe(400);
      const parsed = JSON.parse(res.body) as ParsedResponse<unknown>;
      expect(parsed.success).toBe(false);
      expect(parsed.code).toBe('INVALID_REQUEST');
      // The handler must not forward an invalid request to the provider.
      // (auto-arm may still fire with source 'auto-arm'; that's expected.)
      expect(uiBridgeRequestCalls(provider.request)).toHaveLength(0);
      expect(provider.release).not.toHaveBeenCalled();
    });

    it('rejects a non-boolean "enabled" with INVALID_REQUEST and does not call the provider', async () => {
      const { server } = buildServer(true);
      const provider = makeFakeProvider();
      server.setKeepAwakeProvider(provider);

      const res = await post(server, { enabled: 'yes' });
      expect(res.status).toBe(400);
      const parsed = JSON.parse(res.body) as ParsedResponse<unknown>;
      expect(parsed.success).toBe(false);
      expect(parsed.code).toBe('INVALID_REQUEST');
      expect(uiBridgeRequestCalls(provider.request)).toHaveLength(0);
      expect(provider.release).not.toHaveBeenCalled();
    });
  });

  // ── 4. Happy path ────────────────────────────────────────────────────────
  describe('happy path (provider wired)', () => {
    it('enabled:true + durationMs forwards request("ui-bridge", durationMs)', async () => {
      const { server } = buildServer(true);
      const provider = makeFakeProvider();
      server.setKeepAwakeProvider(provider);

      const res = await post(server, { enabled: true, durationMs: 5000 });
      expect(res.status).toBe(200);
      const parsed = JSON.parse(res.body) as ParsedResponse<{
        enabled: boolean;
        durationMs: number | null;
      }>;
      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual({ enabled: true, durationMs: 5000 });
      expect(provider.request).toHaveBeenCalledWith('ui-bridge', 5000);
      expect(uiBridgeRequestCalls(provider.request)).toEqual([['ui-bridge', 5000]]);
      expect(provider.release).not.toHaveBeenCalled();
    });

    it('enabled:true without durationMs → data.durationMs:null, request("ui-bridge", undefined)', async () => {
      const { server } = buildServer(true);
      const provider = makeFakeProvider();
      server.setKeepAwakeProvider(provider);

      const res = await post(server, { enabled: true });
      expect(res.status).toBe(200);
      const parsed = JSON.parse(res.body) as ParsedResponse<{
        enabled: boolean;
        durationMs: number | null;
      }>;
      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual({ enabled: true, durationMs: null });
      expect(provider.request).toHaveBeenCalledWith('ui-bridge', undefined);
      expect(uiBridgeRequestCalls(provider.request)).toEqual([['ui-bridge', undefined]]);
      expect(provider.release).not.toHaveBeenCalled();
    });

    it('enabled:false releases the lock and reports success', async () => {
      const { server } = buildServer(true);
      const provider = makeFakeProvider();
      server.setKeepAwakeProvider(provider);

      const res = await post(server, { enabled: false });
      expect(res.status).toBe(200);
      const parsed = JSON.parse(res.body) as ParsedResponse<{
        enabled: boolean;
        durationMs: number | null;
      }>;
      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual({ enabled: false, durationMs: null });
      expect(provider.release).toHaveBeenCalledWith('ui-bridge');
      expect(uiBridgeRequestCalls(provider.request)).toHaveLength(0);
    });
  });

  // ── 5. Auto-arm ──────────────────────────────────────────────────────────
  describe('auto-arm', () => {
    it('arms request("auto-arm", 60000) on ANY request when testHooks on + provider wired', async () => {
      const { server } = buildServer(true);
      const provider = makeFakeProvider();
      server.setKeepAwakeProvider(provider);

      const res = await server.handleRequest({
        method: 'GET',
        path: '/ui-bridge/health',
        headers: {},
        query: {},
      });
      expect(res.status).toBe(200);
      expect(provider.request).toHaveBeenCalledWith('auto-arm', 60000);
    });

    it('does NOT auto-arm when testHooks is off', async () => {
      const { server } = buildServer(false);
      const provider = makeFakeProvider();
      // Even if a provider is wired, the auto-arm block is gated on testHooks.
      server.setKeepAwakeProvider(provider);

      const res = await server.handleRequest({
        method: 'GET',
        path: '/ui-bridge/health',
        headers: {},
        query: {},
      });
      expect(res.status).toBe(200);
      expect(provider.request).not.toHaveBeenCalled();
    });

    it('does not throw when the auto-arm provider is unset', async () => {
      const { server } = buildServer(true);
      // No setKeepAwakeProvider call — auto-arm must be a best-effort no-op.

      const res = await server.handleRequest({
        method: 'GET',
        path: '/ui-bridge/health',
        headers: {},
        query: {},
      });
      expect(res.status).toBe(200);
      const parsed = JSON.parse(res.body) as ParsedResponse<unknown>;
      expect(parsed.success).toBe(true);
    });
  });
});
