import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import type { NativeElementRef, NativeLayout } from '../../core/types';
import { NativeUIBridgeServer } from '../http-server';
import type { TapAtResponse } from '../types';

/**
 * Routing + behaviour coverage for `POST /ui-bridge/control/tap`.
 *
 * The handler walks every registered element, picks the topmost (smallest-area)
 * layout rect that contains the (x, y) tap coords, and dispatches the
 * requested action through the standard executor. These tests stub element
 * layout via `updateElementState` (the real path uses RN's `onLayout` /
 * `measureInWindow`).
 */

interface ParsedResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  timestamp: number;
}

function makeRef(): React.RefObject<NativeElementRef> {
  return { current: {} as NativeElementRef };
}

function setLayout(
  registry: NativeUIBridgeRegistry,
  id: string,
  layout: NativeLayout
): void {
  registry.updateElementState(id, {
    mounted: true,
    visible: true,
    enabled: true,
    focused: false,
    layout,
  });
}

async function callTap(
  server: NativeUIBridgeServer,
  body: Record<string, unknown>
): Promise<ParsedResponse<TapAtResponse>> {
  const response = await server.handleRequest({
    method: 'POST',
    path: '/ui-bridge/control/tap',
    headers: { 'Content-Type': 'application/json' },
    query: {},
    body,
  });
  return JSON.parse(response.body) as ParsedResponse<TapAtResponse>;
}

describe('POST /ui-bridge/control/tap — coord-based tap', () => {
  it('dispatches press to the element whose rect contains the coords', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    let pressed = false;

    registry.registerElement('btn-a', makeRef(), {
      type: 'pressable',
      props: {
        onPress: () => {
          pressed = true;
        },
      },
    });
    setLayout(registry, 'btn-a', {
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      pageX: 100,
      pageY: 200,
    });

    const server = new NativeUIBridgeServer(registry, executor);

    // Tap the centre of the rect (pageX=150, pageY=225).
    const parsed = await callTap(server, { x: 150, y: 225 });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.elementId).toBe('btn-a');
    expect(parsed.data?.action).toBe('press');
    expect(pressed).toBe(true);
  });

  it('returns no_element_at_coords when nothing matches', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    registry.registerElement('btn-a', makeRef(), {
      type: 'pressable',
      props: { onPress: () => {} },
    });
    setLayout(registry, 'btn-a', {
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      pageX: 0,
      pageY: 0,
    });

    const server = new NativeUIBridgeServer(registry, executor);
    const parsed = await callTap(server, { x: 9999, y: 9999 });
    expect(parsed.success).toBe(false);
    expect(parsed.code).toBe('no_element_at_coords');
  });

  it('picks the topmost (smallest-area) match when nested elements both contain the coords', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    let outerHit = false;
    let innerHit = false;

    registry.registerElement('outer', makeRef(), {
      type: 'pressable',
      props: {
        onPress: () => {
          outerHit = true;
        },
      },
    });
    setLayout(registry, 'outer', {
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      pageX: 0,
      pageY: 0,
    });

    registry.registerElement('inner', makeRef(), {
      type: 'pressable',
      props: {
        onPress: () => {
          innerHit = true;
        },
      },
    });
    setLayout(registry, 'inner', {
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      pageX: 100,
      pageY: 100,
    });

    const server = new NativeUIBridgeServer(registry, executor);

    // (150, 150) sits inside both rects; the smaller (inner) should win.
    const parsed = await callTap(server, { x: 150, y: 150 });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.elementId).toBe('inner');
    expect(innerHit).toBe(true);
    expect(outerHit).toBe(false);
  });

  it('honours the optional action override (longPress)', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    let longPressed = false;

    registry.registerElement('btn', makeRef(), {
      type: 'pressable',
      props: {
        onPress: () => {},
        onLongPress: () => {
          longPressed = true;
        },
      },
    });
    setLayout(registry, 'btn', {
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      pageX: 0,
      pageY: 0,
    });

    const server = new NativeUIBridgeServer(registry, executor);
    const parsed = await callTap(server, { x: 10, y: 10, action: 'longPress' });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.action).toBe('longPress');
    expect(longPressed).toBe(true);
  });

  it('rejects invalid action values with INVALID_REQUEST', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const server = new NativeUIBridgeServer(registry, executor);
    const parsed = await callTap(server, { x: 0, y: 0, action: 'swipeLeft' });
    expect(parsed.success).toBe(false);
    expect(parsed.code).toBe('INVALID_REQUEST');
  });

  it('rejects missing or non-numeric coords with INVALID_REQUEST', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const server = new NativeUIBridgeServer(registry, executor);

    let parsed = await callTap(server, { x: 'oops', y: 0 });
    expect(parsed.success).toBe(false);
    expect(parsed.code).toBe('INVALID_REQUEST');

    parsed = await callTap(server, { x: 0 });
    expect(parsed.success).toBe(false);
    expect(parsed.code).toBe('INVALID_REQUEST');
  });

  it('falls back to relative x/y when pageX/pageY are missing', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    let pressed = false;

    registry.registerElement('btn', makeRef(), {
      type: 'pressable',
      props: {
        onPress: () => {
          pressed = true;
        },
      },
    });
    // No pageX/pageY — handler must fall through to layout x/y.
    registry.updateElementState('btn', {
      mounted: true,
      visible: true,
      enabled: true,
      focused: false,
      layout: {
        x: 10,
        y: 20,
        width: 50,
        height: 50,
      } as NativeLayout,
    });

    const server = new NativeUIBridgeServer(registry, executor);
    const parsed = await callTap(server, { x: 30, y: 40 });
    expect(parsed.success).toBe(true);
    expect(pressed).toBe(true);
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
      data: { routes: Array<{ method: string; path: string }> };
    };
    expect(
      parsed.data.routes.some((r) => r.method === 'POST' && r.path === '/ui-bridge/control/tap')
    ).toBe(true);
  });
});
