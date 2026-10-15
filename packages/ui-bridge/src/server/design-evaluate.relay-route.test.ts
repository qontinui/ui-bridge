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
 * The requests name a non-default context, element ids and a viewport on
 * purpose. The route did not declare `bodyRequired`, so the Next adapter
 * dropped the body: the caller's context, viewport and element ids never
 * reached a handler, and the trailing handler context landed in the request
 * slot. Each of the three is pinned by its own test, so a handler that drops
 * one of them while keeping the others still fails.
 *
 * Now that the body arrives, it is also validated: a malformed field is
 * answered with `UB-VALIDATION-ERROR`, never computed on.
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

interface RouteReply {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  code?: string;
}

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

/** POST a JSON body to a route under BASE. */
async function post(path: string, payload: unknown): Promise<{ status: number; body: RouteReply }> {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: (await response.json()) as RouteReply };
}

describe('POST /design/evaluate through a relay app', () => {
  let unmount: (() => void) | undefined;
  let relay: CommandRelay | undefined;

  /**
   * The page: `title` (an h1) and `save` (a button) registered, and the
   * production relay hook connected, as CommandRelayListener mounts it.
   */
  async function mountRelayApp(): Promise<void> {
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
  }

  afterEach(() => {
    unmount?.();
    relay?.destroy();
    vi.unstubAllGlobals();
    resetGlobalRegistry();
    document.body.innerHTML = '';
  });

  it('a relay app answers with the requested context, the 28 metrics as values, and no grade', async () => {
    await mountRelayApp();

    const { status, body } = await post('/design/evaluate', {
      context: 'minimal',
      viewport: { width: 1280, height: 800 },
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data!.contextName).toBe('minimal');
    expect(body.data!.metrics).toHaveLength(28);
    expect(body.data!.totalElements).toBe(2);
    expect(body.data).not.toHaveProperty('grade');
    expect(body.data).not.toHaveProperty('uxGrade');
    expect(body.data).not.toHaveProperty('labelCoverage');
  });

  it('the requested element ids reach the evaluator', async () => {
    await mountRelayApp();

    const { body } = await post('/design/evaluate', { elementIds: ['save'] });

    expect(body.success).toBe(true);
    // Two elements are registered; the request names one.
    expect(body.data!.totalElements).toBe(1);
  });

  it('the requested viewport reaches the evaluator', async () => {
    await mountRelayApp();
    // The page's lowest edge is at y=790: inside the requested 800px viewport,
    // below the 768px window the evaluator falls back to without one.
    expect(window.innerHeight).toBe(768);
    const save = document.querySelector('button') as HTMLButtonElement;
    save.getBoundingClientRect = () => new DOMRect(0, 760, 120, 30);

    const { body } = await post('/design/evaluate', { viewport: { width: 1280, height: 800 } });

    expect(body.success).toBe(true);
    expect(body.data!.viewport).toEqual({ width: 1280, height: 800 });
    const metrics = body.data!.metrics as Array<{ metricId: string; score: number }>;
    expect(metrics.find((m) => m.metricId === 'contentOverflow')?.score).toBe(100);
  });

  // The page's dispatcher answers a malformed body with `UB-VALIDATION-ERROR`
  // (pinned on both handler sets in commandHandlers.designEvaluate.test.ts).
  // This test does not pin the code over HTTP: the relay client posts any
  // failure as `ok: false`, and the Next.js `POST /commands` handler keeps only
  // its message, so every coded relay failure reaches the caller as
  // `UB-ACTION-FAILED`. That transport defect predates this route and is
  // recorded as coord finding 388a6c8a.
  it('a malformed body is refused and nothing is computed on it', async () => {
    await mountRelayApp();
    expect((await post('/design/evaluate/baseline', {})).body.success).toBe(true);

    const malformed: Array<[string, unknown, string]> = [
      // A string used to select elements by substring (`String.includes`).
      ['/design/evaluate', { elementIds: 'save' }, 'elementIds must be an array of strings'],
      // A partial viewport used to score every viewport metric on NaN.
      ['/design/evaluate', { viewport: { width: 1280 } }, 'viewport must be { width, height }'],
      ['/design/evaluate/baseline', { elementIds: [1] }, 'elementIds must be an array of strings'],
      ['/design/evaluate/diff', { elementIds: 'save' }, 'elementIds must be an array of strings'],
    ];
    for (const [path, payload, message] of malformed) {
      const { status, body } = await post(path, payload);
      expect({ path, status, success: body.success }).toEqual({
        path,
        status: 200,
        success: false,
      });
      expect(body.error).toContain(`${path}: ${message}`);
      expect(body.data).toBeUndefined();
    }
  });

  it('the baseline and diff routes receive their element ids over HTTP', async () => {
    await mountRelayApp();

    const saved = await post('/design/evaluate/baseline', {
      label: 'before',
      elementIds: ['save'],
    });
    expect(saved.body).toMatchObject({ success: true, data: { saved: true, elementCount: 1 } });

    (document.querySelector('button') as HTMLButtonElement).style.color = 'rgb(255, 0, 0)';
    const diff = (await post('/design/evaluate/diff', { elementIds: ['save'] })).body;
    expect(diff.success).toBe(true);
    expect(diff.data!.added).toEqual([]);
    expect(diff.data!.removed).toEqual([]);
    expect((diff.data!.modified as Array<{ elementId: string }>).map((m) => m.elementId)).toEqual([
      'save',
    ]);
  });
  it('the page reads its stylesheets once per evaluation, and not at all when no metric reads them', async () => {
    await mountRelayApp();
    const style = document.createElement('style');
    style.textContent = ':root { --brand: #123456; } button { --pad: 4px; }';
    document.head.appendChild(style);
    const sheets = vi.spyOn(document, 'styleSheets', 'get');
    try {
      // A context that enables no metric reading custom properties: the page
      // never walks its stylesheets.
      const skipped = await post('/design/evaluate', {
        customContext: {
          name: 'no-custom-properties',
          description: 'customPropertyConsistency off',
          metrics: {
            customPropertyConsistency: {
              enabled: false,
              weight: 0,
              thresholds: { good: 80, warning: 50 },
            },
          },
        },
      });
      expect(skipped.body.success).toBe(true);
      expect(sheets).not.toHaveBeenCalled();

      // The default context reads them: one pass for the whole batch, not one
      // per element.
      const read = await post('/design/evaluate', { context: 'general' });
      expect(read.body.success).toBe(true);
      expect(read.body.data!.totalElements).toBe(2);
      expect(sheets).toHaveBeenCalledTimes(1);
    } finally {
      sheets.mockRestore();
      style.remove();
    }
  });
});
