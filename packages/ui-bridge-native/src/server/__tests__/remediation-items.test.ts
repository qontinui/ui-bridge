import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import { NativeUIBridgeServer } from '../http-server';
import type { NativeElementRef } from '../../core/types';

/**
 * Coverage for the mobile/native SDK remediation items:
 *
 *  - Item A: input value reflected in state + `setValue` action advertised.
 *  - Item B: `sdk/network-requests`, `control/console-errors`,
 *            `control/discover` return 200 (not 404).
 *
 * (Item C — RN layout-derived visibility — lives in the React hook and is
 * covered behaviourally by snapshot-visibility.test.ts; the hook itself
 * requires a React renderer.)
 */

function makeRef(): React.RefObject<NativeElementRef> {
  return { current: {} as NativeElementRef };
}

function buildServer() {
  const registry = new NativeUIBridgeRegistry();
  const executor = new DefaultNativeActionExecutor(registry);
  const server = new NativeUIBridgeServer(registry, executor);
  return { registry, executor, server };
}

// ── Item A: input value + actions ───────────────────────────────────────────

describe('Item A — input element value getter + actions', () => {
  it('advertises type/setValue/clear (and focus/blur) on input elements', () => {
    const { registry } = buildServer();
    const el = registry.registerElement('email', makeRef(), { type: 'input' });
    for (const action of ['type', 'setValue', 'clear', 'focus', 'blur'] as const) {
      expect(el.actions).toContain(action);
    }
  });

  it('reflects a typed value in state.value (GET on the element returns it)', async () => {
    const { registry, executor } = buildServer();
    let bound = '';
    registry.registerElement('email', makeRef(), {
      type: 'input',
      props: { onChangeText: (t: string) => (bound = t) },
    });

    const res = await executor.executeAction('email', {
      action: 'type',
      params: { text: 'hello@example.test' },
    });
    expect(res.success).toBe(true);
    expect(bound).toBe('hello@example.test');
    expect(registry.getElement('email')?.getState().value).toBe('hello@example.test');
  });

  it('setValue replaces the value atomically and syncs state.value', async () => {
    const { registry, executor } = buildServer();
    let bound = 'stale';
    registry.registerElement('name', makeRef(), {
      type: 'input',
      props: { onChangeText: (t: string) => (bound = t) },
    });

    const res = await executor.executeAction('name', {
      action: 'setValue',
      params: { text: 'Ada' },
    });
    expect(res.success).toBe(true);
    expect(bound).toBe('Ada');
    expect(registry.getElement('name')?.getState().value).toBe('Ada');
  });

  it('setValue accepts the web-bridge `value` alias', async () => {
    const { registry, executor } = buildServer();
    let bound = '';
    registry.registerElement('city', makeRef(), {
      type: 'input',
      props: { onChangeText: (t: string) => (bound = t) },
    });

    const res = await executor.executeAction('city', {
      action: 'setValue',
      params: { value: 'Berlin' } as Record<string, unknown>,
    });
    expect(res.success).toBe(true);
    expect(bound).toBe('Berlin');
    expect(registry.getElement('city')?.getState().value).toBe('Berlin');
  });
});

// ── Item B: routes return 200, not 404 ──────────────────────────────────────

describe('Item B — previously-404 SDK routes now return 200', () => {
  it('GET /ui-bridge/control/discover returns a snapshot (200)', async () => {
    const { registry, server } = buildServer();
    registry.registerElement('btn', makeRef(), { type: 'button' });

    const res = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/control/discover',
      headers: {},
      query: {},
    });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.success).toBe(true);
    expect(Array.isArray(parsed.data.elements)).toBe(true);
  });

  it('POST /ui-bridge/control/discover also returns 200 (web/runner parity)', async () => {
    const { server } = buildServer();
    const res = await server.handleRequest({
      method: 'POST',
      path: '/ui-bridge/control/discover',
      headers: {},
      query: {},
      body: {},
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
  });

  it('GET /ui-bridge/control/console-errors returns 200 with a schema-valid body', async () => {
    const { server } = buildServer();
    const res = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/control/console-errors',
      headers: {},
      query: {},
    });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.success).toBe(true);
    expect(Array.isArray(parsed.data.entries)).toBe(true);
    expect(typeof parsed.data.count).toBe('number');
    expect(typeof parsed.data.installed).toBe('boolean');
  });

  it('GET /ui-bridge/sdk/network-requests returns 200 with a schema-valid body', async () => {
    const { server } = buildServer();
    const res = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/sdk/network-requests',
      headers: {},
      query: {},
    });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.success).toBe(true);
    expect(Array.isArray(parsed.data.entries)).toBe(true);
    expect(typeof parsed.data.count).toBe('number');
    expect(typeof parsed.data.installed).toBe('boolean');
  });

  it('all three routes appear in /_routes', async () => {
    const { server } = buildServer();
    const res = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/_routes',
      headers: {},
      query: {},
    });
    const paths = JSON.parse(res.body).data.routes.map((r: { path: string }) => r.path);
    expect(paths).toContain('/ui-bridge/control/discover');
    expect(paths).toContain('/ui-bridge/control/console-errors');
    expect(paths).toContain('/ui-bridge/sdk/network-requests');
  });
});
