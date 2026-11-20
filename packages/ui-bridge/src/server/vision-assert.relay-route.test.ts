// @vitest-environment jsdom
/**
 * `POST /vision/assert` through the relay with NO runner, entered where a
 * tenant's acceptance harness enters: the Next route handler queues the
 * command, the page's production relay hook (`useCommandRelay`) receives it,
 * the page's dispatcher evaluates it in the tab, and the answer comes back as
 * the HTTP response. Until plan
 * 2026-11-09-ui-bridge-relay-evaluates-vision-assertions-in-the-tab Phase 1,
 * the relay answered `RUNNER_REQUIRED` → `UB-CAPABILITY-UNAVAILABLE` and no
 * relay harness could get a verdict.
 *
 * jsdom does no layout, so the boxes the cases need are given to the
 * elements directly; colours and paint order (which need a real hit test)
 * answer `unknown` here and are proven in real Chromium by
 * `vision/dom-assertions.smoke.test.ts`. The in-process handlers
 * (`createHandlers`) answer from the same function, pinned at the bottom.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { CommandRelay } from './command-relay';
import { createNextRouteHandlers } from './nextjs';
import { createRelayHandlers } from './relay-handlers';
import { createHandlers, type RegistryLike } from './handlers';
import { useCommandRelay } from '../react/useCommandRelay';
import { getGlobalRegistry, resetGlobalRegistry } from '../core/registry';
import { DefaultActionExecutor } from '../control/action-executor';
import type { VisionAssertResponse } from '../vision/wire';

const BASE = 'http://relay.test/api/ui-bridge';
const PACKAGE_VERSION = (
  JSON.parse(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8')
  ) as { version: string }
).version;

type Routes = ReturnType<typeof createNextRouteHandlers>;

interface RouteReply {
  success: boolean;
  data?: VisionAssertResponse;
  error?: string;
  code?: string;
}

/** Serve a fetch from the Next route handlers, in process. */
function routeFetch(routes: Routes): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(BASE)) return new Response('not routed', { status: 404 });
    const nextUrl = new URL(url);
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
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Register a div with a laid-out box (jsdom lays nothing out). */
function register(id: string, text: string, rect?: [number, number, number, number]): HTMLElement {
  const el = document.createElement('div');
  el.textContent = text;
  document.body.appendChild(el);
  if (rect) {
    const r = new DOMRect(...rect);
    el.getBoundingClientRect = () => r;
    el.getClientRects = () => [r] as unknown as DOMRectList;
  }
  getGlobalRegistry().registerElement(id, el, { type: 'generic' });
  return el;
}

async function post(payload: unknown): Promise<{ status: number; body: RouteReply }> {
  const response = await fetch(`${BASE}/vision/assert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: (await response.json()) as RouteReply };
}

describe('POST /vision/assert through a relay app, no runner mounted', () => {
  let unmount: (() => void) | undefined;
  let relay: CommandRelay | undefined;

  async function mountRelayApp(): Promise<void> {
    resetGlobalRegistry();
    register('card', 'Order #1', [0, 0, 100, 100]);
    register('badge', 'New', [80, 80, 40, 40]);
    register('footer', 'Footer', [0, 200, 100, 50]);
    register('ghost', 'Not laid out');

    relay = new CommandRelay({
      globalPrefix: `__uiBridgeVision_${Math.random().toString(36).slice(2, 10)}`,
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
    vi.restoreAllMocks();
    resetGlobalRegistry();
    document.body.innerHTML = '';
  });

  it('answers a per-assertion outcome measured in the tab, not UB-CAPABILITY-UNAVAILABLE', async () => {
    await mountRelayApp();

    const { status, body } = await post({
      assertions: [
        { type: 'no_overlap', elements: ['card', 'badge'] },
        { type: 'no_overlap', elements: ['card', 'footer'] },
        { type: 'no_overlap', elements: ['card', 'nowhere'] },
        { type: 'no_overlap', elements: ['card', 'ghost'] },
        { type: 'image_palette_within', element: 'card', palette: [{ r: 0, g: 0, b: 0 }] },
        { type: 'element_above', elements: ['badge', 'card'] },
      ],
    });

    expect(status).toBe(200);
    expect(body.code).not.toBe('UB-CAPABILITY-UNAVAILABLE');
    expect(body.success).toBe(true);
    const data = body.data!;
    expect(data.results.map((r) => [r.outcome, r.code ?? null])).toEqual([
      ['failed', null],
      ['passed', null],
      ['unknown', 'input_missing'],
      ['unknown', 'input_missing'],
      ['unknown', 'capability_unavailable_in_build'],
      // jsdom implements no document.elementsFromPoint: paint order is unmeasurable.
      ['unknown', 'hit_test_unmeasurable'],
    ]);
    expect(data.results[0].detail).toBe('card and badge overlap by 400 px² (tolerance 0 px)');
    expect(data.results[2].detail).toContain("element 'nowhere' is not in the snapshot");
    expect(data.results[3].detail).toContain("element 'ghost' carries no geometry (bbox)");
    // The echo is vision-core's normalized assertion.
    expect(data.results[0].assertion).toEqual({
      type: 'no_overlap',
      elements: ['card', 'badge'],
      tolerance_px: null,
    });
    for (const r of data.results) {
      expect(r.confidence).toBeNull();
      expect(r.passed).toBe(r.outcome === 'passed');
    }

    expect(data.outcome).toBe('failed');
    expect(data.outcomeCounts).toEqual({ passed: 1, failed: 1, unknown: 4 });
    expect(data.unknownCodes).toEqual([
      'input_missing',
      'capability_unavailable_in_build',
      'hit_test_unmeasurable',
    ]);
    expect(data.frame).toMatchObject({
      status: 'unknown',
      unknown: { code: 'capability_unavailable_in_build' },
    });
    expect(data.snapshotAttribution).toMatchObject({ state: 'attributed' });
    expect((data.snapshotAttribution as { snapshotId: string }).snapshotId).toMatch(/^ubs2_/);
    expect(data.provenance.producer).toEqual({
      id: 'sdk/vision-assertions',
      version: PACKAGE_VERSION,
    });
    expect(data.provenance.confidence).toBeNull();
    expect(data.provenance.coverage.considered).toBe(6);
    expect(data.provenance.coverage.measured).toBe(2);
    expect(data.coverage).toMatchObject({ withGeometry: 3 });
    expect(Number.isNaN(Date.parse(data.evaluatedAt))).toBe(false);
  });

  it('an empty assertion list answers unknown(no_results), never a pass', async () => {
    await mountRelayApp();
    const { body } = await post({ assertions: [] });
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      results: [],
      outcome: 'unknown',
      outcomeCounts: { passed: 0, failed: 0, unknown: 0 },
      unknownCodes: ['no_results'],
    });
  });

  it('a malformed body is refused with UB-VALIDATION-ERROR and never reaches the relay queue', async () => {
    await mountRelayApp();
    const queued = vi.spyOn(relay!, 'queueCommand');
    const assertsQueued = (): number =>
      queued.mock.calls.filter(([action]) => action === 'visionAssert').length;

    for (const malformed of [
      {},
      { assertions: 'no_overlap' },
      { assertions: [{ type: 'no_overlapping', elements: ['a', 'b'] }] },
      { assertions: [{ type: 'no_overlap', elements: ['a'] }] },
      { assertions: [{ type: 'contrast_meets_wcag', element: 'card', level: 'AA' }] },
      { assertions: [], snapshot: { elements: [] } },
    ]) {
      const { status, body } = await post(malformed);
      expect({ status, success: body.success, code: body.code }).toEqual({
        status: 200,
        success: false,
        code: 'UB-VALIDATION-ERROR',
      });
      expect(body.error).toContain('/vision/assert:');
      expect(body.data).toBeUndefined();
    }
    expect(assertsQueued()).toBe(0);

    // The spy does see the queue: a valid body is queued exactly once.
    const valid = await post({
      assertions: [{ type: 'no_overlap', elements: ['card', 'footer'] }],
    });
    expect(valid.body.success).toBe(true);
    expect(assertsQueued()).toBe(1);
  });
});

describe('POST /vision/assert through the in-process handlers', () => {
  afterEach(() => {
    resetGlobalRegistry();
    document.body.innerHTML = '';
  });

  it('answers from the same in-tab evaluator', async () => {
    resetGlobalRegistry();
    register('card', 'Order #1', [0, 0, 100, 100]);
    register('badge', 'New', [80, 80, 40, 40]);
    const registry = getGlobalRegistry();
    const handlers = createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never,
      { networkMonitoring: false }
    );

    const res = await handlers.visionAssert({
      assertions: [
        { type: 'no_overlap', elements: ['card', 'badge'], tolerance_px: 30 },
        { type: 'settled_within', ms: 100 },
      ],
    });
    expect(res.success).toBe(true);
    expect(res.data!.results.map((r) => [r.outcome, r.code ?? null])).toEqual([
      ['passed', null],
      ['unknown', 'capability_unavailable_in_build'],
    ]);
    expect(res.data!.provenance.producer.id).toBe('sdk/vision-assertions');

    const bad = await handlers.visionAssert({ assertions: [{ type: 'no_overlap' }] });
    expect(bad).toMatchObject({ success: false, code: 'UB-VALIDATION-ERROR' });
  });
});
