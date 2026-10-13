/**
 * The capability listings advertise only routes that exist.
 *
 * `getCapabilities` (`GET /capabilities`) is how an agent discovers what the SDK
 * serves. Both listings kept advertising routes long after their handlers were
 * deleted: the eight `/ai/media/*` routes and `/control/get-element-images`,
 * whose handlers were removed in the same commit, 2d35d0d (2026-05-14).
 * Measured live in plan
 * 2026-10-13-image-generation-and-visual-judgment Phase 1, a caller that
 * believed the listing got a 404 from the SDK route adapter, or a 30 s timeout
 * through a WebSocket-relayed app. The plan's D6 retires the media family
 * without a successor.
 *
 * The second invariant is general so that the NEXT dead advertisement fails
 * too: every advertised endpoint is a route the SDK's route table
 * (`UI_BRIDGE_ROUTES`) declares, or one of the two SSE streams the HTTP
 * adapters serve ahead of that table (`express.ts`, `nextjs.ts`,
 * `standalone.ts`).
 */

import { describe, expect, it } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';
import { createRelayHandlers } from './relay-handlers';
import { CommandRelay } from './command-relay';
import { UI_BRIDGE_ROUTES, type CapabilitiesResponse } from './types';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from '../control/action-executor';

/** Served by the HTTP adapters before the route table is consulted. */
const ADAPTER_SERVED = ['GET /control/events/stream', 'GET /control/changes/stream'];

const DECLARED = new Set([
  ...UI_BRIDGE_ROUTES.map((route) => `${route.method} ${route.path}`),
  ...ADAPTER_SERVED,
]);

function advertised(listing: CapabilitiesResponse): string[] {
  return Object.values(listing.categories).flatMap((category) =>
    category.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`)
  );
}

async function serverListing(): Promise<CapabilitiesResponse> {
  const registry = new UIBridgeRegistry();
  // No idle detector: its debounced DOM scans would outlive this file's jsdom.
  const handlers = createHandlers(
    registry as unknown as RegistryLike,
    new DefaultActionExecutor(registry) as never,
    { idleDetection: false }
  );
  const response = await handlers.getCapabilities();
  expect(response.success).toBe(true);
  return response.data!;
}

async function relayListing(): Promise<CapabilitiesResponse> {
  // Own globalThis-key prefix: CommandRelay persists state on globalThis.
  const relay = new CommandRelay({
    globalPrefix: `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`,
  });
  const response = await createRelayHandlers(relay).getCapabilities();
  expect(response.success).toBe(true);
  return response.data!;
}

describe.each([
  ['server handlers', serverListing],
  ['relay handlers', relayListing],
])('%s · getCapabilities', (_transport, readListing) => {
  it('advertises no /ai/media route and no media category', async () => {
    const listing = await readListing();
    const endpoints = advertised(listing);
    // The listing was read, not empty: an empty one would pass vacuously.
    expect(endpoints.length).toBeGreaterThan(5);
    expect(endpoints.filter((endpoint) => endpoint.includes(' /ai/media'))).toEqual([]);
    expect(Object.keys(listing.categories)).not.toContain('media');
  });

  it('advertises only routes the SDK declares', async () => {
    const listing = await readListing();
    expect(advertised(listing).filter((endpoint) => !DECLARED.has(endpoint))).toEqual([]);
  });
});
