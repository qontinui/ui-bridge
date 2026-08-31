/**
 * Every route this package PUBLISHES must be reachable in the router.
 *
 * Post-merge follow-up to qontinui/ui-bridge#175. `UI_BRIDGE_NATIVE_ROUTES`
 * (`./types`) is exported from the package root (`src/native/index.ts`) and is
 * the contract an external consumer reads to learn what
 * `@qontinui/ui-bridge/native` serves. It declared four page-navigation
 * routes — `control/page/refresh`, `.../navigate`, `.../back`, `.../forward` —
 * that `NativeUIBridgeServer.routeRequest` had no branch for, while
 * `createServerHandlers` implemented all four and `NativeServerHandlers` typed
 * them. Three layers of one package, disagreeing about whether the endpoint
 * exists; the consumer got the route-not-found tail.
 *
 * A table and a chain of `if`s cannot be made to check each other by the type
 * system, so they are checked here instead. This asserts REACHABILITY only —
 * an endpoint may legitimately answer `NOT_SUPPORTED`, or reject the request —
 * never that a route succeeds.
 *
 * DIRECTION: table ⊆ router. The reverse drift — a branch wired in
 * `routeRequest` but never published in the table — is NOT caught here, and
 * this package has no route-introspection endpoint to catch it with (the
 * sibling has `buildRoutesPayload`). That direction now has a consequence
 * beyond documentation: `routeRequest`'s wrong-verb arm derives 405 from this
 * same table, so an unpublished-but-routed path degrades to 404 on a wrong verb
 * instead of 405.
 */

import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../core/registry';
import { NativeUIBridgeServer } from './http-server';
import { UI_BRIDGE_NATIVE_ROUTES } from './types';

interface ParsedResponse {
  success: boolean;
  error?: string;
  code?: string;
}

/**
 * Every executor method the routed handlers reach.
 *
 * `find` is load-bearing: without it the `FIND is routed` case still passed,
 * but only because `handlers.find` threw a TypeError into `handleRequest`'s
 * catch and answered 500 — which is not a route miss, so the assertion held
 * for the wrong reason. A handler exception must not be able to masquerade as
 * routing success, which is why the `is routed` case below rejects
 * INTERNAL_ERROR too.
 */
function stubExecutor() {
  return {
    executeAction: async () => ({ success: true, durationMs: 0, timestamp: 0 }),
    executeComponentAction: async () => ({ success: true, durationMs: 0, timestamp: 0 }),
    find: async () => ({ elements: [], count: 0, timestamp: 0 }),
  };
}

/** Fill `:id`-style segments with a placeholder so the pattern can match. */
function concretePath(path: string): string {
  return path
    .split('/')
    .map((segment) => (segment.startsWith(':') ? `parity-${segment.slice(1)}` : segment))
    .join('/');
}

/**
 * The route-not-found tail in `routeRequest`, identified by its own message.
 *
 * Matching the message rather than the `NOT_FOUND` code matters: a handler is
 * free to answer `NOT_FOUND` about a resource, and that is a ROUTED response.
 */
function isRouteMiss(parsed: ParsedResponse): boolean {
  return parsed.code === 'NOT_FOUND' && (parsed.error ?? '').startsWith('Route not found:');
}

describe('UI_BRIDGE_NATIVE_ROUTES parity with the router', () => {
  const entries = Object.entries(UI_BRIDGE_NATIVE_ROUTES);

  it('publishes at least the routes this test was written against', () => {
    // Guards against the table being emptied or renamed out from under the
    // loop below, which would make every case vacuously pass.
    expect(entries.length).toBeGreaterThanOrEqual(16);
    expect(Object.keys(UI_BRIDGE_NATIVE_ROUTES)).toEqual(
      expect.arrayContaining([
        'PAGE_REFRESH',
        'PAGE_NAVIGATE',
        'PAGE_GO_BACK',
        'PAGE_GO_FORWARD',
        'HEALTH',
      ])
    );
  });

  it.each(entries)('%s is routed', async (_name, route) => {
    const server = new NativeUIBridgeServer(new NativeUIBridgeRegistry(), stubExecutor() as never);

    const res = await server.handleRequest({
      method: route.method,
      path: concretePath(route.path),
      headers: {},
      query: {},
      body: {},
    });

    const parsed = JSON.parse(res.body) as ParsedResponse;
    expect(isRouteMiss(parsed)).toBe(false);
    // A handler that blew up is not a routed handler. Without this, a missing
    // stub method turns into a 500 that satisfies the route-miss check.
    expect(parsed.code).not.toBe('INTERNAL_ERROR');
  });

  it('reports an undeclared path as a route miss at runtime', async () => {
    const server = new NativeUIBridgeServer(new NativeUIBridgeRegistry(), stubExecutor() as never);
    const res = await server.handleRequest({
      method: 'POST',
      path: '/ui-bridge/control/visibility',
      headers: {},
      query: {},
      body: {},
    });
    expect(isRouteMiss(JSON.parse(res.body) as ParsedResponse)).toBe(true);
  });
});
