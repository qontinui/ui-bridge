import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import type { NativeElementRef } from '../../core/types';
import { createServerHandlers } from '../handlers';

/**
 * Action-envelope contract parity (P1 remediation).
 *
 * `POST /control/element/:id/action` must accept the same `{ action, params }`
 * envelope the runner/web SDK uses. Two shapes reach the native handler:
 *
 *   1. Flat HTTP body — `{ action, params, waitOptions }` threaded straight
 *      into `ctx.body` (the documented HTTP shape).
 *   2. Relay/WS nested envelope — the runner SDK dispatches element actions as
 *      `relayCommand('executeElementAction', { id, request })`; over the
 *      WS/JSON-RPC + cloud-relay transports the whole `params` object becomes
 *      `ctx.body`, so the action lives at `body.request.action`.
 *
 * Regression: shape (2) was rejected with "Action is required" because the
 * handler only read the flat `body.action` field.
 */

function makeRef(): React.RefObject<NativeElementRef> {
  return { current: {} as NativeElementRef };
}

function makeHandlers() {
  const registry = new NativeUIBridgeRegistry();
  const executor = new DefaultNativeActionExecutor(registry);
  const pressed = { count: 0 };
  registry.registerElement('btn', makeRef(), {
    type: 'pressable',
    label: 'Go',
    props: {
      onPress: () => {
        pressed.count += 1;
      },
    },
  });
  return { handlers: createServerHandlers(registry, executor), pressed };
}

describe('executeAction — action-envelope contract', () => {
  it('accepts the flat HTTP envelope { action: "press" }', async () => {
    const { handlers, pressed } = makeHandlers();
    const res = await handlers.executeAction({
      params: { id: 'btn' },
      query: {},
      body: { action: 'press' },
    });
    expect(res.success).toBe(true);
    expect(pressed.count).toBe(1);
  });

  it('accepts the flat envelope with params { action, params }', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    let typed = '';
    registry.registerElement('field', makeRef(), {
      type: 'input',
      label: 'Email',
      props: { onChangeText: (t: string) => { typed = t; } },
    });
    const handlers = createServerHandlers(registry, executor);
    const res = await handlers.executeAction({
      params: { id: 'field' },
      query: {},
      body: { action: 'setValue', params: { text: 'a@b.com' } },
    });
    expect(res.success).toBe(true);
    expect(typed).toBe('a@b.com');
  });

  it('accepts the relay/WS nested envelope { id, request: { action } }', async () => {
    const { handlers, pressed } = makeHandlers();
    // The WS/relay path delivers the whole JSON-RPC `params` as `ctx.body`;
    // path params are empty because routing keys off the method string.
    const res = await handlers.executeAction({
      params: {},
      query: {},
      body: { id: 'btn', request: { action: 'press' } },
    });
    expect(res.success).toBe(true);
    expect(pressed.count).toBe(1);
  });

  it('accepts the nested envelope with params { id, request: { action, params } }', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    let typed = '';
    registry.registerElement('field', makeRef(), {
      type: 'input',
      label: 'Email',
      props: { onChangeText: (t: string) => { typed = t; } },
    });
    const handlers = createServerHandlers(registry, executor);
    const res = await handlers.executeAction({
      params: {},
      query: {},
      body: { id: 'field', request: { action: 'setValue', params: { text: 'hi@x.com' } } },
    });
    expect(res.success).toBe(true);
    expect(typed).toBe('hi@x.com');
  });

  it('prefers the path :id over body.id for the nested envelope', async () => {
    const { handlers, pressed } = makeHandlers();
    const res = await handlers.executeAction({
      params: { id: 'btn' },
      query: {},
      body: { id: 'ignored', request: { action: 'press' } },
    });
    expect(res.success).toBe(true);
    expect(pressed.count).toBe(1);
  });

  it('still rejects a body with no action in either shape', async () => {
    const { handlers } = makeHandlers();
    const res = await handlers.executeAction({
      params: { id: 'btn' },
      query: {},
      body: { params: { text: 'x' } },
    });
    expect(res.success).toBe(false);
    expect(res.code).toBe('INVALID_REQUEST');
    expect(res.error).toBe('Action is required');
  });
});
