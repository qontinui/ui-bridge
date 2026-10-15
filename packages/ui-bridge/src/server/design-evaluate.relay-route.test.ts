// @vitest-environment jsdom
/**
 * `POST /design/evaluate` through the relay, entered where the population enters.
 *
 * A relay-connected React app (qontinui-web mounts `CommandRelayListener`, which
 * runs `useCommandRelay`) answers `/design/evaluate` in the browser:
 *   1. the Next route handler queues the command on the relay;
 *   2. the page's relay client receives it on the command stream;
 *   3. the page's dispatcher answers it;
 *   4. the answer comes back as the HTTP response.
 * Until plan 2026-10-13-image-generation-and-visual-judgment Phase 6, step 3
 * answered with a label/action coverage score and no metrics. A server mounted
 * on the registry directly answered with the 28-metric report, so one route
 * had two models.
 *
 * The request names a non-default context on purpose. The route did not
 * declare `bodyRequired`, so the Next adapter dropped the body: the caller's
 * context, viewport and element ids never reached a handler, and the trailing
 * handler context landed in the request slot.
 *
 * Nothing here calls the dispatcher or the evaluator directly. The request
 * enters at the HTTP route, and the page side is the production hook. The
 * fetch bridge stands in only for the network between the page and the route.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { CommandRelay } from './command-relay';
import { createNextRouteHandlers } from './nextjs';
import { createRelayHandlers } from './relay-handlers';
import { useCommandRelay } from '../react/useCommandRelay';
import { getGlobalRegistry, resetGlobalRegistry } from '../core/registry';

const BASE = 'http://relay.test/api/ui-bridge';

type Routes = ReturnType<typeof createNextRouteHandlers>;

/** Serve a fetch from the Next route handlers, in process. */
function routeFetch(routes: Routes): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(BASE)) return new Response('not routed', { status: 404 });
    const nextUrl = new URL(url);
    // The client's own abort signal rides on the request, so the command
    // stream closes, and the server side cleans up, when the client stops.
    const request = Object.assign(new Request(url, init), { nextUrl });
    const path = nextUrl.pathname.slice(new URL(BASE).pathname.length + 1);
    const method = (init?.method ?? 'GET').toUpperCase() as keyof Routes;
    return routes[method](request, { params: { path } });
  };
}

async function until(check: () => boolean, what: string, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function register(id: string, tag: string, text: string): void {
  const el = document.createElement(tag);
  el.textContent = text;
  document.body.appendChild(el);
  getGlobalRegistry().registerElement(id, el, { type: tag === 'button' ? 'button' : 'generic' });
}

describe('POST /design/evaluate through a relay app', () => {
  let unmount: (() => void) | undefined;
  let relay: CommandRelay | undefined;

  afterEach(() => {
    unmount?.();
    relay?.destroy();
    vi.unstubAllGlobals();
    resetGlobalRegistry();
    document.body.innerHTML = '';
  });

  it('a relay app answers with the requested context, the 28 metrics as values, and no grade', async () => {
    resetGlobalRegistry();
    register('title', 'h1', 'Orders');
    register('save', 'button', 'Save');

    relay = new CommandRelay({
      globalPrefix: `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`,
    });
    const routes = createNextRouteHandlers(createRelayHandlers(relay), { relay });
    vi.stubGlobal('fetch', routeFetch(routes));

    // The page: the production relay hook, as CommandRelayListener mounts it.
    ({ unmount } = renderHook(() => useCommandRelay({ basePath: BASE, disablePhoneHome: true })));
    await until(() => relay!.getConnectedTabs().length === 1, 'the page to join the relay');

    const response = await fetch(`${BASE}/design/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: 'minimal', viewport: { width: 1280, height: 800 } }),
    });
    const body = (await response.json()) as {
      success: boolean;
      data: Record<string, unknown> & { metrics?: unknown[] };
    };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.contextName).toBe('minimal');
    expect(body.data.metrics).toHaveLength(28);
    expect(body.data.totalElements).toBe(2);
    expect(body.data).not.toHaveProperty('grade');
    expect(body.data).not.toHaveProperty('uxGrade');
    expect(body.data).not.toHaveProperty('labelCoverage');
  });

  it('the baseline and diff routes receive their element ids over HTTP', async () => {
    resetGlobalRegistry();
    register('title', 'h1', 'Orders');
    register('save', 'button', 'Save');

    relay = new CommandRelay({
      globalPrefix: `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`,
    });
    const routes = createNextRouteHandlers(createRelayHandlers(relay), { relay });
    vi.stubGlobal('fetch', routeFetch(routes));
    ({ unmount } = renderHook(() => useCommandRelay({ basePath: BASE, disablePhoneHome: true })));
    await until(() => relay!.getConnectedTabs().length === 1, 'the page to join the relay');

    const post = async (path: string, payload: unknown) => {
      const response = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return (await response.json()) as { success: boolean; data: Record<string, unknown> };
    };

    const saved = await post('/design/evaluate/baseline', {
      label: 'before',
      elementIds: ['save'],
    });
    expect(saved).toMatchObject({ success: true, data: { saved: true, elementCount: 1 } });

    (document.querySelector('button') as HTMLButtonElement).style.color = 'rgb(255, 0, 0)';
    const diff = await post('/design/evaluate/diff', { elementIds: ['save'] });
    expect(diff.success).toBe(true);
    expect(diff.data.added).toEqual([]);
    expect(diff.data.removed).toEqual([]);
    expect((diff.data.modified as Array<{ elementId: string }>).map((m) => m.elementId)).toEqual([
      'save',
    ]);
  });
});
