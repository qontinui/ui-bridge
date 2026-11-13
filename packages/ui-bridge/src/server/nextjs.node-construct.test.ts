// @vitest-environment node
/**
 * `createUIBridgeHandler()` is the documented zero-config Next.js App Router
 * entry: it runs in a route handler, where there is no `document`, no
 * `MutationObserver` and no `XMLHttpRequest`. It used to throw on
 * construction there (the network tracker patched `XMLHttpRequest`
 * unguarded, then the DOM idle signals read `document.body`), so the whole
 * route module failed to load; once it constructed, most routes then threw a
 * `ReferenceError` that surfaced as UB-UNKNOWN-ERROR.
 *
 * This suite runs in the plain Node environment, not jsdom, so a browser
 * global reached on construction or on any route fails it.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createUIBridgeHandler } from './nextjs';
import { UI_BRIDGE_ROUTES } from './types';
import { NetworkIdleDetector } from '../idle/network-idle';
import { NetworkRequestTracker } from '../network/tracker';

function req(method: string, path: string, body?: unknown) {
  const url = `https://test.local/api/ui-bridge${path}`;
  const request = new Request(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  Object.defineProperty(request, 'nextUrl', { value: new URL(url) });
  const segments = path.split('?')[0]!.split('/').filter(Boolean);
  return [request, { params: { path: segments } }] as const;
}

async function call(
  handler: ReturnType<typeof createUIBridgeHandler>,
  method: string,
  path: string,
  body?: unknown
): Promise<{
  status: number;
  json: { success: boolean; code?: string; error?: string; data?: unknown };
}> {
  const [request, context] = req(method, path, body);
  const res = await handler(request as never, context as never);
  return { status: res.status, json: await res.json() };
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('createUIBridgeHandler in a server runtime (no DOM, no XMLHttpRequest)', () => {
  it('has no browser globals to lean on', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
    expect(typeof XMLHttpRequest).toBe('undefined');
    expect(typeof MutationObserver).toBe('undefined');
  });

  it('constructs, and leaves the process fetch unpatched', () => {
    expect(() => createUIBridgeHandler()).not.toThrow();
    // Patching fetch here would record the server's own outbound calls
    // (credential headers included) and serve them on /control/network-requests.
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it('serves a read with its stub registry', async () => {
    const handler = createUIBridgeHandler();
    for (const path of ['/control/elements', '/control/snapshot']) {
      const { status, json } = await call(handler, 'GET', path);
      expect(status, path).toBe(200);
      expect(json.success, `${path}: ${json.error}`).toBe(true);
    }
    const found = await call(handler, 'POST', '/control/find', {});
    expect(found.json.success, found.json.error).toBe(true);
  });

  it('refuses an assertion that names nothing, typed, before anything runs', async () => {
    const { json } = await call(createUIBridgeHandler(), 'POST', '/ai/assert', {});
    expect(json.success).toBe(false);
    expect(json.code).toBe('UB-VALIDATION-ERROR');
  });

  it('answers idle and network reads with the typed disabled refusal, never an unobserved idle', async () => {
    const handler = createUIBridgeHandler();
    const idle = await call(handler, 'GET', '/control/idle-status');
    expect(idle.json.success).toBe(false);
    expect(idle.json.error).toMatch(/no page in this runtime/);
    const network = await call(handler, 'GET', '/control/network-requests');
    expect(network.json.success).toBe(false);
    expect(network.json.error).toMatch(/no page in this runtime/);
  });

  it('refuses a page-only route as a capability this runtime does not serve', async () => {
    const { json } = await call(createUIBridgeHandler(), 'POST', '/control/page/refresh', {});
    expect(json.success).toBe(false);
    expect(json.code).toBe('UB-CAPABILITY-UNAVAILABLE');
    expect(json.data).toMatchObject({ reason: 'no_browser_context' });
  });

  it('reaches no browser global on any route', async () => {
    const handler = createUIBridgeHandler();
    const leaks: string[] = [];
    for (const route of UI_BRIDGE_ROUTES) {
      const path = route.path.replace(/:[^/]+/g, 'x');
      const body = route.method === 'GET' || route.method === 'DELETE' ? undefined : {};
      const [request, context] = req(route.method, path, body);
      // Wait routes poll until their own timeout; only a prompt answer is read.
      const res = await Promise.race([
        handler(request as never, context as never),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
      ]);
      if (!res) continue;
      const text = await res.text();
      if (/\b\w+ is not defined/.test(text)) {
        leaks.push(`${route.method} ${route.path}: ${text.slice(0, 120)}`);
      }
    }
    expect(leaks).toEqual([]);
    expect(globalThis.fetch).toBe(originalFetch);
  }, 60_000);
});

describe('network interceptors in a server runtime', () => {
  it('NetworkRequestTracker does not patch fetch without a page', () => {
    const tracker = new NetworkRequestTracker();
    tracker.install();
    expect(globalThis.fetch).toBe(originalFetch);
    tracker.destroy();
  });

  it('NetworkIdleDetector without a shared tracker does not patch fetch without a page', () => {
    const detector = new NetworkIdleDetector({});
    expect(() => detector.install()).not.toThrow();
    expect(globalThis.fetch).toBe(originalFetch);
    detector.destroy();
  });
});
