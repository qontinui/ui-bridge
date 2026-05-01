import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import { NativeUIBridgeServer } from '../http-server';
import { ModalDetector } from '../../modal/modal-detector';
import type {
  DismissModalResponse,
  PushModalResponse,
} from '../types';

/**
 * Routing + state coverage for `POST /ui-bridge/control/modal/push` and
 * `POST /ui-bridge/control/modal/dismiss/:id`.
 *
 * The new endpoints are gated by `features.testHooks` (mirrored to
 * `NativeServerConfig.testHooks`). With the gate on, a push round-trip
 * should flip `snapshot.modalStack.count` from 0 → 1, and a dismiss
 * round-trip should flip it back to 0. With the gate off the routes
 * must be invisible (NOT_FOUND) and absent from the `/_routes` manifest.
 */

interface ParsedResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  timestamp: number;
}

function buildServerWithDetector(testHooks = true) {
  const registry = new NativeUIBridgeRegistry();
  const executor = new DefaultNativeActionExecutor(registry);
  const modalDetector = new ModalDetector();
  registry.setEnrichers({ modalDetector });
  const server = new NativeUIBridgeServer(registry, executor, { testHooks });
  return { registry, executor, modalDetector, server };
}

describe('POST /ui-bridge/control/modal/push + dismiss/:id — round trip', () => {
  it('push then dismiss round-trips snapshot.modalStack count', async () => {
    const { registry, server } = buildServerWithDetector();

    expect(registry.createSnapshot().modalStack?.count).toBe(0);

    const pushResponse = await server.handleRequest({
      method: 'POST',
      path: '/ui-bridge/control/modal/push',
      headers: { 'Content-Type': 'application/json' },
      query: {},
      body: {
        id: 'm-1',
        title: 'Settings changed',
        type: 'dialog',
        blocking: true,
        dismissible: true,
      },
    });
    expect(pushResponse.status).toBe(200);
    const pushParsed = JSON.parse(pushResponse.body) as ParsedResponse<PushModalResponse>;
    expect(pushParsed.success).toBe(true);
    expect(pushParsed.data?.pushed).toBe(true);
    expect(pushParsed.data?.id).toBe('m-1');
    expect(pushParsed.data?.title).toBe('Settings changed');
    expect(pushParsed.data?.type).toBe('dialog');

    // Snapshot reflects the push immediately.
    let snap = registry.createSnapshot();
    expect(snap.modalStack?.count).toBe(1);
    expect(snap.modalStack?.modals[0].id).toBe('m-1');
    expect(snap.modalStack?.hasBlockingModal).toBe(true);

    const dismissResponse = await server.handleRequest({
      method: 'POST',
      path: '/ui-bridge/control/modal/dismiss/m-1',
      headers: { 'Content-Type': 'application/json' },
      query: {},
      body: {},
    });
    expect(dismissResponse.status).toBe(200);
    const dismissParsed = JSON.parse(
      dismissResponse.body
    ) as ParsedResponse<DismissModalResponse>;
    expect(dismissParsed.success).toBe(true);
    expect(dismissParsed.data?.dismissed).toBe('m-1');

    snap = registry.createSnapshot();
    expect(snap.modalStack?.count).toBe(0);
  });

  it('returns ENRICHER_UNAVAILABLE when no modalDetector is wired', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const server = new NativeUIBridgeServer(registry, executor, { testHooks: true });

    const response = await server.handleRequest({
      method: 'POST',
      path: '/ui-bridge/control/modal/push',
      headers: { 'Content-Type': 'application/json' },
      query: {},
      body: { id: 'm-1' },
    });
    expect(response.status).toBe(400);
    const parsed = JSON.parse(response.body) as ParsedResponse<unknown>;
    expect(parsed.success).toBe(false);
    expect(parsed.code).toBe('ENRICHER_UNAVAILABLE');
  });

  it('returns MODAL_NOT_FOUND when dismissing an unknown id', async () => {
    const { server } = buildServerWithDetector();
    const response = await server.handleRequest({
      method: 'POST',
      path: '/ui-bridge/control/modal/dismiss/missing',
      headers: { 'Content-Type': 'application/json' },
      query: {},
      body: {},
    });
    expect(response.status).toBe(400);
    const parsed = JSON.parse(response.body) as ParsedResponse<unknown>;
    expect(parsed.success).toBe(false);
    expect(parsed.code).toBe('MODAL_NOT_FOUND');
  });

  it('rejects push without an id', async () => {
    const { server } = buildServerWithDetector();
    const response = await server.handleRequest({
      method: 'POST',
      path: '/ui-bridge/control/modal/push',
      headers: { 'Content-Type': 'application/json' },
      query: {},
      body: { title: 'no-id' },
    });
    expect(response.status).toBe(400);
    const parsed = JSON.parse(response.body) as ParsedResponse<unknown>;
    expect(parsed.success).toBe(false);
    expect(parsed.code).toBe('INVALID_REQUEST');
  });

  it('routes both endpoints in /_routes when testHooks is on', async () => {
    const { server } = buildServerWithDetector(true);
    const response = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/_routes',
      headers: {},
      query: {},
    });
    expect(response.status).toBe(200);
    const parsed = JSON.parse(response.body) as {
      data: { routes: Array<{ method: string; path: string }> };
    };
    const paths = parsed.data.routes.map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain('POST /ui-bridge/control/modal/push');
    expect(paths).toContain('POST /ui-bridge/control/modal/dismiss/:id');
  });

  it('hides both endpoints (NOT_FOUND + omitted from /_routes) when testHooks is off', async () => {
    const { server } = buildServerWithDetector(false);

    // Direct invocation 404s.
    const direct = await server.handleRequest({
      method: 'POST',
      path: '/ui-bridge/control/modal/push',
      headers: { 'Content-Type': 'application/json' },
      query: {},
      body: { id: 'm-1' },
    });
    expect(direct.status).toBe(400);
    const directParsed = JSON.parse(direct.body) as ParsedResponse<unknown>;
    expect(directParsed.code).toBe('NOT_FOUND');

    // Manifest excludes the test-hook routes.
    const manifest = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/_routes',
      headers: {},
      query: {},
    });
    expect(manifest.status).toBe(200);
    const manifestParsed = JSON.parse(manifest.body) as {
      data: { routes: Array<{ method: string; path: string }> };
    };
    const paths = manifestParsed.data.routes.map((r) => r.path);
    expect(paths).not.toContain('/ui-bridge/control/modal/push');
    expect(paths).not.toContain('/ui-bridge/control/modal/dismiss/:id');
  });
});
