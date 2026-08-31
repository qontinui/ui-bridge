/**
 * The route table this package PUBLISHES and the one it ROUTES must be the
 * same set — in both directions.
 *
 * Post-merge follow-up to qontinui/ui-bridge#189, which added the mirror of
 * this ratchet to the sibling surface (`packages/ui-bridge/src/native/server/
 * route-table-parity.test.ts`) and left this package's copy of the same
 * two-declaration problem unpinned.
 *
 * `UI_BRIDGE_NATIVE_ROUTES` (`../types`) is exported from the package root and
 * is what an external consumer reads to learn what `@qontinui/ui-bridge-native`
 * serves. `WS_ROUTES` (`../http-server`, module-private) is what `routeRequest`
 * actually iterates and what `buildRoutesPayload` publishes at
 * `GET /ui-bridge/_routes`. Nothing in the package read the first, so nothing
 * made them agree — and they had stopped: measured 2026-08-31, the router
 * served 56 method+path pairs and the table published 36. Every published entry
 * was reachable; twenty served routes were unpublished, including
 * `control/tap`, `control/screenshot`, `ai/find`, the five `control/page/*`
 * interaction endpoints (`click-by-text`, `click-by-selector`, `type-into`,
 * `read-value`, `find-by-text`), the four `design/evaluate*` endpoints and the
 * two discovery endpoints a consumer would use to find the rest.
 *
 * DIRECTION — both, which is the difference from the sibling's copy. That test
 * can only assert table ⊆ router, and its header says so: the parent package has
 * no route-introspection endpoint to check the reverse with. This one does, so
 * the reverse drift (a route wired in `WS_ROUTES` but never published) fails
 * here rather than silently shrinking the published contract.
 *
 * `_routes` is the right thing to compare against precisely BECAUSE it is
 * derived from `WS_ROUTES` — the same array `routeRequest` iterates. Set
 * equality with it is therefore a statement about the router rather than about
 * a third hand-written list, **for 54 of the 56 entries**: `buildRoutesPayload`
 * appends `_help` and `_routes` by hand, since neither is in `WS_ROUTES`. Those
 * two are covered instead by the runtime probe, which is the independent half
 * throughout — it proves each published path really dispatches, catching a
 * `parsePath` quirk that membership alone would miss.
 *
 * TWO route sets are compared, not one. Three routes (`control/modal/push`,
 * `control/modal/dismiss/:id`, `control/keep-awake`) are mounted only when the
 * server config sets `testHooks`, and `UI_BRIDGE_NATIVE_ROUTES` is a static
 * constant that lists them unconditionally. Comparing only at `testHooks: true`
 * would leave the PRODUCTION surface — the one nearly every consumer meets —
 * asserted by nothing, so a fourth gated route, or one of these three
 * accidentally un-gated, could change it with every test still green. Each
 * entry therefore carries `requiresTestHooks`, and the flag-off comparison
 * pins the table minus exactly the flagged subset.
 */

import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { NativeUIBridgeServer } from '../http-server';
import { UI_BRIDGE_NATIVE_ROUTES } from '../types';

interface ParsedResponse {
  success: boolean;
  error?: string;
  code?: string;
  data?: { routes?: Array<{ method: string; path: string }> };
}

/**
 * Every executor method a routed handler reaches.
 *
 * Load-bearing, for the reason #189's sibling test records: a missing stub
 * makes the handler throw into `handleRequest`'s catch and answer 500, which is
 * not a route miss — so the reachability assertion would hold for the wrong
 * reason. The dispatch case below rejects INTERNAL_ERROR to close that off.
 */
function stubExecutor() {
  return {
    executeAction: async () => ({ success: true, durationMs: 0, timestamp: 0 }),
    executeComponentAction: async () => ({ success: true, durationMs: 0, timestamp: 0 }),
    find: async () => ({ elements: [], count: 0, timestamp: 0 }),
  };
}

function server(testHooks: boolean): NativeUIBridgeServer {
  return new NativeUIBridgeServer(
    new NativeUIBridgeRegistry(),
    stubExecutor() as never,
    {
      testHooks,
    } as never
  );
}

async function request(method: string, path: string, testHooks = true): Promise<ParsedResponse> {
  const res = await server(testHooks).handleRequest({
    method,
    path,
    headers: {},
    query: {},
    body: {},
  });
  return JSON.parse(res.body) as ParsedResponse;
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

const key = (method: string, path: string): string => `${method} ${path}`;

const entries = Object.values(UI_BRIDGE_NATIVE_ROUTES);
const published = entries.map((r) => key(r.method, r.path));
/** What the table claims a PRODUCTION build (`testHooks: false`) serves. */
const publishedUngated = entries
  .filter((r) => !r.requiresTestHooks)
  .map((r) => key(r.method, r.path));

async function routedKeys(testHooks: boolean): Promise<string[]> {
  const parsed = await request('GET', '/ui-bridge/_routes', testHooks);
  const routes = parsed.data?.routes;
  if (!routes || routes.length === 0) {
    throw new Error('GET /ui-bridge/_routes returned no routes — extraction is broken, not clean');
  }
  return routes.map((r) => key(r.method, r.path));
}

describe('UI_BRIDGE_NATIVE_ROUTES agrees with the router, in both directions', () => {
  it('publishes at least the routes this test was written against', () => {
    // Guards against the table being emptied or renamed out from under the
    // comparisons below, which would make an empty-vs-empty check pass.
    expect(published.length).toBeGreaterThanOrEqual(50);
    expect(new Set(published).size).toBe(published.length);
    expect(Object.keys(UI_BRIDGE_NATIVE_ROUTES)).toEqual(
      expect.arrayContaining(['HEALTH', 'ROUTES', 'HELP', 'CONTROL_TAP', 'PAGE_CLICK_BY_TEXT'])
    );
    // And that the gated subset is neither empty (which would make the
    // production comparison the same assertion twice) nor everything.
    expect(publishedUngated.length).toBeGreaterThanOrEqual(50);
    expect(published.length - publishedUngated.length).toBe(3);
  });

  it('lists every route the router mounts under testHooks', async () => {
    const unpublished = (await routedKeys(true)).filter((k) => !published.includes(k)).sort();
    expect(unpublished).toEqual([]);
  });

  it('lists nothing the router does not mount under testHooks', async () => {
    const routed = await routedKeys(true);
    expect(published.filter((k) => !routed.includes(k)).sort()).toEqual([]);
  });

  it('matches the PRODUCTION surface exactly once the gated three are removed', async () => {
    // The set nearly every consumer meets. Asserted in both directions against
    // a `testHooks: false` server, so `requiresTestHooks` cannot drift from the
    // gate it describes: un-gating one of the three, or adding a fourth gated
    // route without flagging it, fails here.
    const routed = await routedKeys(false);
    expect(routed.filter((k) => !publishedUngated.includes(k)).sort()).toEqual([]);
    expect(publishedUngated.filter((k) => !routed.includes(k)).sort()).toEqual([]);
  });

  it.each(entries.map((r) => [`${r.method} ${r.path}`, r] as const))(
    '%s dispatches at runtime',
    async (_n, route) => {
      const parsed = await request(route.method, concretePath(route.path));
      expect(isRouteMiss(parsed)).toBe(false);
      // A handler that blew up is not a routed handler. Without this, a missing
      // stub method turns into a 500 that satisfies the route-miss check.
      expect(parsed.code).not.toBe('INTERNAL_ERROR');
    }
  );

  it('reports an undeclared path as a route miss at runtime', async () => {
    // The negative control. Without it every assertion above could be
    // satisfied by a router that answers everything.
    expect(isRouteMiss(await request('POST', '/ui-bridge/control/nonexistent'))).toBe(true);
  });

  it('answers a gated route as a plain 404 on a production build', async () => {
    // The other half of the negative control: the gated three must be absent
    // from the production surface rather than merely unlisted, and absent as a
    // ROUTE MISS — not as a handler declining.
    const parsed = await request('POST', '/ui-bridge/control/keep-awake', false);
    expect(isRouteMiss(parsed)).toBe(true);
  });
});
