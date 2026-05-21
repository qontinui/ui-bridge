/**
 * Manual-test iter-4 remediation tests for page-health POST empty body.
 *
 * Item B — `POST /control/page-health` with `Content-Type: application/json`
 * but a zero-byte body must NOT 400 with "Unexpected end of JSON input"
 * (EOF). The handler takes no required parameters, so a no-body POST is
 * the natural shape for callers; making it a 400 forces callers to send
 * `'{}'` payloads they shouldn't have to construct.
 *
 * Fix lives in `express.ts` (pre-body-parser middleware normalizes empty
 * JSON bodies to `{}`) and `standalone.ts` (already correct — verified
 * here to lock in the contract). The handler itself is parameterless.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StandaloneServer } from './standalone';
import { createHandlers } from './handlers';
import type { RegistryLike, ActionExecutorLike } from './handlers';

const registry: RegistryLike = {
  getAllElements: () => [],
  getElement: () => undefined,
  getAllComponents: () => [],
  getComponent: () => undefined,
  findElements: () => [],
  createSnapshot: () =>
    ({
      elements: [],
      components: [],
      workflows: [],
      timestamp: Date.now(),
    }) as unknown as ReturnType<RegistryLike['createSnapshot']>,
};

const actionExecutor: ActionExecutorLike = {
  executeAction: async () => ({ success: true }) as never,
  find: async () => ({ elements: [] }) as never,
};

let server: StandaloneServer;
let base: string;

beforeAll(async () => {
  const handlers = createHandlers(registry, actionExecutor);
  server = new StandaloneServer(handlers, { port: 0, host: '127.0.0.1' });
  await server.start();
  const addr = server.getAddress();
  if (!addr) throw new Error('server did not bind');
  base = `http://127.0.0.1:${addr.port}/ui-bridge`;
});

afterAll(async () => {
  await server.stop();
});

describe('iter-4 Item B — POST /control/page-health empty body', () => {
  it('200 OK with empty body + application/json (no payload required)', async () => {
    const res = await fetch(`${base}/control/page-health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No body — this is the curl case from the manual test report.
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    // The report shape: status + findings + heatmap + stats + timestamp.
    expect(body.data.status).toMatch(/^(healthy|degraded|unhealthy)$/);
    expect(Array.isArray(body.data.findings)).toBe(true);
    expect(Array.isArray(body.data.heatmap)).toBe(true);
  });

  it('200 OK with explicit "{}" body (regression — both shapes work)', async () => {
    const res = await fetch(`${base}/control/page-health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('200 OK with NO Content-Type header at all (no parser conflict)', async () => {
    const res = await fetch(`${base}/control/page-health`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
