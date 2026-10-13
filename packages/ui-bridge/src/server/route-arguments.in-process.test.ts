/**
 * Over HTTP, the in-process handlers (`createHandlers`) receive the arguments
 * their signatures name.
 *
 * The in-process set serves the same route table as the relay handlers: the
 * standalone server, or a Next.js / Express mount beside the registry. When a
 * route disagrees with its handler here, nothing is misrouted, but the request
 * is lost: the action id arrives as the request, the intent name is dropped,
 * and a query option is ignored. `route-scoping.test.ts` covers the relay
 * handlers, and `route-argument-alignment.test.ts` pins the declarations.
 * These tests go through the Next.js catch-all.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';
import { createNextRouteHandlers } from './nextjs';

const BASE = '/api/ui-bridge';

/** Every request the executor was handed, in order. */
let executed: Array<Record<string, unknown>>;

/** A registry with no elements and a three-entry action history. */
function registry(): RegistryLike {
  return {
    getAllElements: () => [],
    getElement: () => undefined,
    getAllComponents: () => [],
    getComponent: () => undefined,
    createSnapshot: () =>
      ({ timestamp: 0, elements: [], components: [], workflows: [] }) as unknown as ReturnType<
        RegistryLike['createSnapshot']
      >,
    getActionHistory: () => ['first', 'second', 'third'],
  };
}

function recordingExecutor() {
  return {
    executeAction: async () => ({ success: true }),
    executeComponentAction: async (id: string, request: Record<string, unknown>) => {
      executed.push({ id, ...request });
      return { success: true, result: 'ok', durationMs: 1, timestamp: 0 };
    },
  };
}

// None of these routes reads an idle signal. Leaving the idle detector off
// keeps its DOM observers and scan timers from outliving this file's jsdom
// environment.
const NO_IDLE = { idleDetection: false } as const;

/** One request through the Next.js catch-all over a fresh in-process handler set. */
async function inProcessCall(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<Record<string, unknown>> {
  const routes = createNextRouteHandlers(
    createHandlers(registry(), recordingExecutor() as never, NO_IDLE)
  );
  const url = `http://app.test${BASE}${path}`;
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const nextUrl = new URL(url);
  const request = Object.assign(new Request(url, init), { nextUrl });
  const params = { path: nextUrl.pathname.slice(BASE.length + 1) };
  const response = await routes[method](request, { params });
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  executed = [];
});

describe('in-process handlers over the Next.js catch-all', () => {
  it('a component action reaches the executor with the action id from the URL and the body as its request', async () => {
    const res = await inProcessCall('POST', '/control/component/login-form/action/submit', {
      user: 'ada',
      params: { remember: true },
      timeoutMs: 2500,
      tabId: 'tab-1',
    });
    expect(res.success).toBe(true);
    expect(executed).toEqual([
      {
        id: 'login-form',
        action: 'submit',
        params: { user: 'ada', remember: true },
        timeoutMs: 2500,
      },
    ]);
  });

  it('a named intent is looked up by the name in the URL', async () => {
    const res = await inProcessCall('POST', '/control/intent/checkout/execute', {
      params: { size: 2 },
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe('Intent not found: checkout');
  });

  it('the history limit in the query string is applied', async () => {
    const res = await inProcessCall('GET', '/control/history?limit=2');
    expect(res.success).toBe(true);
    expect(res.data).toEqual(['second', 'third']);
  });
});
