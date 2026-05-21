import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import { NativeUIBridgeServer } from '../http-server';

/**
 * Routing coverage for the four runner-only `/ai/*` endpoints that the mobile
 * bridge mounts as explicit NOT_SUPPORTED stubs.
 *
 * Why these exist: the runner-side UI Bridge exposes
 *   GET  /ui-bridge/ai/forms
 *   GET  /ui-bridge/ai/idle-status
 *   POST /ui-bridge/ai/change-buffer/enable
 *   POST /ui-bridge/ai/wait-for-element
 *
 * and the /manual-test skill's cheatsheet documents them as if they're
 * universally available. Mobile React Native has no DOM analog for any of
 * them, so a manual-test operator probing these against a mobile bridge
 * previously got either a confusing HTTP 404 or a `{success:false}` envelope
 * with no `error` field. The stubs guarantee a structured NOT_SUPPORTED
 * response that names a mobile-native replacement in the message.
 */

interface ParsedResponse {
  success: boolean;
  error?: string;
  code?: string;
  timestamp: number;
}

function buildServer() {
  const registry = new NativeUIBridgeRegistry();
  const executor = new DefaultNativeActionExecutor(registry);
  return new NativeUIBridgeServer(registry, executor);
}

describe('mobile bridge — runner-only /ai/* endpoints return NOT_SUPPORTED stubs', () => {
  // ── ai/forms ───────────────────────────────────────────────────────────────
  describe('GET /ui-bridge/ai/forms', () => {
    it('returns NOT_SUPPORTED with a mobile-native hint in the error message', async () => {
      const server = buildServer();
      const res = await server.handleRequest({
        method: 'GET',
        path: '/ui-bridge/ai/forms',
        headers: {},
        query: {},
      });
      expect(res.status).toBe(400);
      const parsed = JSON.parse(res.body) as ParsedResponse;
      expect(parsed.success).toBe(false);
      expect(parsed.code).toBe('NOT_SUPPORTED');
      expect(parsed.error).toMatch(/ai\/forms/);
      // The error message must name the mobile-native replacement so an
      // operator inspecting the response knows what to do instead.
      expect(parsed.error).toMatch(/control\/snapshot/);
    });

    it('shows up in /_routes manifest', async () => {
      const server = buildServer();
      const res = await server.handleRequest({
        method: 'GET',
        path: '/ui-bridge/_routes',
        headers: {},
        query: {},
      });
      const parsed = JSON.parse(res.body) as {
        data: { routes: Array<{ method: string; path: string }> };
      };
      const paths = parsed.data.routes.map((r) => `${r.method} ${r.path}`);
      expect(paths).toContain('GET /ui-bridge/ai/forms');
    });
  });

  // ── ai/idle-status ─────────────────────────────────────────────────────────
  describe('GET /ui-bridge/ai/idle-status', () => {
    it('returns NOT_SUPPORTED with a mobile-native hint in the error message', async () => {
      const server = buildServer();
      const res = await server.handleRequest({
        method: 'GET',
        path: '/ui-bridge/ai/idle-status',
        headers: {},
        query: {},
      });
      expect(res.status).toBe(400);
      const parsed = JSON.parse(res.body) as ParsedResponse;
      expect(parsed.success).toBe(false);
      expect(parsed.code).toBe('NOT_SUPPORTED');
      expect(parsed.error).toMatch(/idle-status/);
      // Point operators at the WS event stream as the mobile replacement.
      expect(parsed.error).toMatch(/WS|registry event/i);
    });

    it('shows up in /_routes manifest', async () => {
      const server = buildServer();
      const res = await server.handleRequest({
        method: 'GET',
        path: '/ui-bridge/_routes',
        headers: {},
        query: {},
      });
      const parsed = JSON.parse(res.body) as {
        data: { routes: Array<{ method: string; path: string }> };
      };
      const paths = parsed.data.routes.map((r) => `${r.method} ${r.path}`);
      expect(paths).toContain('GET /ui-bridge/ai/idle-status');
    });
  });

  // ── ai/change-buffer/enable ────────────────────────────────────────────────
  describe('POST /ui-bridge/ai/change-buffer/enable', () => {
    it('returns NOT_SUPPORTED with a mobile-native hint in the error message', async () => {
      const server = buildServer();
      const res = await server.handleRequest({
        method: 'POST',
        path: '/ui-bridge/ai/change-buffer/enable',
        headers: { 'Content-Type': 'application/json' },
        query: {},
        body: {},
      });
      expect(res.status).toBe(400);
      const parsed = JSON.parse(res.body) as ParsedResponse;
      expect(parsed.success).toBe(false);
      expect(parsed.code).toBe('NOT_SUPPORTED');
      expect(parsed.error).toMatch(/change-buffer/);
      // Point operators at the WS event bridge as the mobile replacement.
      expect(parsed.error).toMatch(/WS|event bridge/i);
    });

    it('shows up in /_routes manifest', async () => {
      const server = buildServer();
      const res = await server.handleRequest({
        method: 'GET',
        path: '/ui-bridge/_routes',
        headers: {},
        query: {},
      });
      const parsed = JSON.parse(res.body) as {
        data: { routes: Array<{ method: string; path: string }> };
      };
      const paths = parsed.data.routes.map((r) => `${r.method} ${r.path}`);
      expect(paths).toContain('POST /ui-bridge/ai/change-buffer/enable');
    });
  });

  // ── ai/wait-for-element ────────────────────────────────────────────────────
  describe('POST /ui-bridge/ai/wait-for-element', () => {
    it('returns NOT_SUPPORTED with a mobile-native hint in the error message', async () => {
      const server = buildServer();
      const res = await server.handleRequest({
        method: 'POST',
        path: '/ui-bridge/ai/wait-for-element',
        headers: { 'Content-Type': 'application/json' },
        query: {},
        body: { id: 'foo', timeout: 1000 },
      });
      expect(res.status).toBe(400);
      const parsed = JSON.parse(res.body) as ParsedResponse;
      expect(parsed.success).toBe(false);
      expect(parsed.code).toBe('NOT_SUPPORTED');
      expect(parsed.error).toMatch(/wait-for-element/);
      // Direct operators at the WS waitForElement method.
      expect(parsed.error).toMatch(/WS|waitForElement/);
    });

    it('shows up in /_routes manifest', async () => {
      const server = buildServer();
      const res = await server.handleRequest({
        method: 'GET',
        path: '/ui-bridge/_routes',
        headers: {},
        query: {},
      });
      const parsed = JSON.parse(res.body) as {
        data: { routes: Array<{ method: string; path: string }> };
      };
      const paths = parsed.data.routes.map((r) => `${r.method} ${r.path}`);
      expect(paths).toContain('POST /ui-bridge/ai/wait-for-element');
    });
  });

  // ── Cross-cutting: each stub has a distinct error message ─────────────────
  it('each stub returns a distinct error message so operators can tell them apart', async () => {
    const server = buildServer();
    const reqs: Array<{ method: 'GET' | 'POST'; path: string }> = [
      { method: 'GET', path: '/ui-bridge/ai/forms' },
      { method: 'GET', path: '/ui-bridge/ai/idle-status' },
      { method: 'POST', path: '/ui-bridge/ai/change-buffer/enable' },
      { method: 'POST', path: '/ui-bridge/ai/wait-for-element' },
    ];

    const errors = await Promise.all(
      reqs.map(async (r) => {
        const res = await server.handleRequest({
          method: r.method,
          path: r.path,
          headers: {},
          query: {},
          body: r.method === 'POST' ? {} : undefined,
        });
        const parsed = JSON.parse(res.body) as ParsedResponse;
        return parsed.error;
      })
    );

    // All four error strings must be unique so operators can grep responses
    // and identify which endpoint failed without inspecting the URL.
    expect(new Set(errors).size).toBe(4);
  });
});
