/**
 * Phase 2 — diagnostic catalog HTTP routes.
 *
 * Plan: 2026-05-18-ui-bridge-diagnostic-discipline-plan.md §8 (Phase 2).
 *
 * Boots a real StandaloneServer on an ephemeral port and exercises the two
 * new read-only catalog routes end-to-end (route registration + handler):
 *
 *   GET /diagnostics/catalog       -> whole catalog (agent bootstrap)
 *   GET /diagnostics/:code         -> one code's catalog entry
 *
 * Asserts: known code returns the same JSON the generated single-source
 * catalog holds; unknown code returns a 404-shaped APIResponse carrying a
 * canonical UiBridgeErrorCode (Phase 1 error() path); the pre-existing
 * `GET /diagnostics` SDK-state endpoint is untouched.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StandaloneServer } from './standalone';
import { createHandlers } from './handlers';
import type { RegistryLike, ActionExecutorLike } from './handlers';
import {
  DIAGNOSTICS,
  UI_BRIDGE_ERROR_CODES,
} from '@qontinui/ui-bridge/diagnostics';

// Minimal stubs — the catalog handlers do not touch the registry/executor.
const registry: RegistryLike = {
  getAllElements: () => [],
  getElement: () => undefined,
  getAllComponents: () => [],
  getComponent: () => undefined,
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

describe('Phase 2 — GET /diagnostics/catalog', () => {
  it('returns every catalog code with the codes.json entry shape', async () => {
    const res = await fetch(`${base}/diagnostics/catalog`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.count).toBe(UI_BRIDGE_ERROR_CODES.length);
    expect(Array.isArray(body.data.codes)).toBe(true);

    const returned = new Set(body.data.codes.map((c: { code: string }) => c.code));
    for (const code of UI_BRIDGE_ERROR_CODES) {
      expect(returned.has(code), `${code} missing from catalog`).toBe(true);
    }

    const sample = body.data.codes.find(
      (c: { code: string }) => c.code === 'UB-ELEM-NOT-FOUND'
    );
    expect(sample.category).toBe(DIAGNOSTICS['UB-ELEM-NOT-FOUND'].category);
    expect(sample.description).toBe(
      DIAGNOSTICS['UB-ELEM-NOT-FOUND'].description
    );
    expect(sample.commonCauses).toEqual(
      DIAGNOSTICS['UB-ELEM-NOT-FOUND'].commonCauses
    );
    expect(sample.recoveryTemplate).toEqual(
      DIAGNOSTICS['UB-ELEM-NOT-FOUND'].recoveryTemplate
    );
  });
});

describe('Phase 2 — GET /diagnostics/:code', () => {
  it('returns a single code entry for a known code', async () => {
    const res = await fetch(`${base}/diagnostics/UB-ELEM-NOT-FOUND`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.code).toBe('UB-ELEM-NOT-FOUND');
    expect(body.data.category).toBe('element');
    expect(body.data.description).toBe(
      DIAGNOSTICS['UB-ELEM-NOT-FOUND'].description
    );
    expect(body.data.recoveryTemplate).toEqual(
      DIAGNOSTICS['UB-ELEM-NOT-FOUND'].recoveryTemplate
    );
  });

  it('every catalog code resolves via the :code route', async () => {
    for (const code of UI_BRIDGE_ERROR_CODES) {
      const res = await fetch(`${base}/diagnostics/${code}`);
      expect(res.status, `${code} should resolve`).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.code).toBe(code);
    }
  });

  it('unknown code returns a failure APIResponse with a canonical code', async () => {
    const res = await fetch(`${base}/diagnostics/UB-DOES-NOT-EXIST`);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Unknown diagnostic code: UB-DOES-NOT-EXIST');
    // Phase 1 mapper resolves the internal 'NOT_FOUND' to a canonical code.
    expect(body.code).toBe('UB-ELEM-NOT-FOUND');
    expect(UI_BRIDGE_ERROR_CODES).toContain(body.code);
  });
});

describe('Phase 2 — pre-existing /diagnostics (SDK state) is untouched', () => {
  it('GET /diagnostics still returns SDK runtime state, not the catalog', async () => {
    const res = await fetch(`${base}/diagnostics`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // SDK-state shape, NOT a {codes,count} catalog payload.
    expect(body.data).toHaveProperty('sdk_initialized');
    expect(body.data).not.toHaveProperty('codes');
  });

  it('the catalog literal /diagnostics/catalog is not captured as :code', async () => {
    const res = await fetch(`${base}/diagnostics/catalog`);
    const body = await res.json();
    expect(body.success).toBe(true);
    // Would be a single-entry {code:'catalog'...} failure if mis-routed.
    expect(body.data).toHaveProperty('count');
  });
});
