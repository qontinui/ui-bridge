import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import type { NativeElementRef } from '../../core/types';
import { NativeUIBridgeServer } from '../http-server';
import type { FillFormResponse } from '../types';

/**
 * End-to-end routing smoke for `POST /ui-bridge/ai/fill-form`.
 *
 * Drives the request through `NativeUIBridgeServer.handleRequest` (the
 * same entry point an HTTP adapter uses) so we cover the route table
 * + verb dispatch as well as the handler body.
 */

function makeInputRef(): React.RefObject<NativeElementRef> {
  return { current: {} as NativeElementRef };
}

describe('POST /ui-bridge/ai/fill-form — routing smoke', () => {
  it('dispatches via the HTTP route table and returns the FillFormResponse envelope', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const seen: Record<string, string> = {};
    registry.registerElement('input-a', makeInputRef(), {
      type: 'input',
      props: {
        onChangeText: (t: string) => {
          seen['input-a'] = t;
        },
      },
    });
    registry.registerElement('input-b', makeInputRef(), {
      type: 'input',
      props: {
        onChangeText: (t: string) => {
          seen['input-b'] = t;
        },
      },
    });

    const server = new NativeUIBridgeServer(registry, executor);
    const response = await server.handleRequest({
      method: 'POST',
      path: '/ui-bridge/ai/fill-form',
      headers: { 'Content-Type': 'application/json' },
      query: {},
      body: {
        fields: [
          { elementId: 'input-a', value: 'alpha' },
          { elementId: 'input-b', value: 'beta' },
        ],
      },
    });

    expect(response.status).toBe(200);
    const parsed = JSON.parse(response.body) as {
      success: boolean;
      data: FillFormResponse;
      timestamp: number;
    };
    expect(parsed.success).toBe(true);
    expect(parsed.data.succeededCount).toBe(2);
    expect(parsed.data.failedCount).toBe(0);
    expect(parsed.data.results).toEqual([
      { elementId: 'input-a', success: true },
      { elementId: 'input-b', success: true },
    ]);
    expect(typeof parsed.timestamp).toBe('number');
    expect(seen).toEqual({ 'input-a': 'alpha', 'input-b': 'beta' });
  });

  it('returns METHOD_NOT_ALLOWED on GET /ai/fill-form', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const server = new NativeUIBridgeServer(registry, executor);

    const response = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/ai/fill-form',
      headers: {},
      query: {},
    });

    expect(response.status).toBe(400);
    const parsed = JSON.parse(response.body);
    expect(parsed.success).toBe(false);
    expect(parsed.code).toBe('METHOD_NOT_ALLOWED');
  });

  it('shows up in the /_routes manifest', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const server = new NativeUIBridgeServer(registry, executor);

    const response = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/_routes',
      headers: {},
      query: {},
    });

    expect(response.status).toBe(200);
    const parsed = JSON.parse(response.body) as {
      success: boolean;
      data: { routes: Array<{ method: string; path: string }> };
    };
    expect(parsed.success).toBe(true);
    expect(
      parsed.data.routes.some((r) => r.method === 'POST' && r.path === '/ui-bridge/ai/fill-form')
    ).toBe(true);
  });
});
