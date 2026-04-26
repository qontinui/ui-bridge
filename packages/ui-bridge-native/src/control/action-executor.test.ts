import { describe, it, expect, vi } from 'vitest';
import { DefaultNativeActionExecutor } from './action-executor';
import { NativeUIBridgeRegistry } from '../core/registry';
import type { NativeElementRef } from '../core/types';
import type { NativeActionEvent } from './types';

function makeRef(handlers: Record<string, unknown> = {}): React.RefObject<NativeElementRef> {
  return { current: { ...handlers } as unknown as NativeElementRef };
}

function makePressableRegistry(elementId = 'btn'): {
  registry: NativeUIBridgeRegistry;
  pressed: { count: number };
} {
  const registry = new NativeUIBridgeRegistry();
  const pressed = { count: 0 };
  registry.registerElement(elementId, makeRef(), {
    type: 'button',
    props: {
      onPress: () => {
        pressed.count++;
      },
    },
  });
  return { registry, pressed };
}

describe('DefaultNativeActionExecutor.onActionExecuted', () => {
  it('fires listener on a successful action with success=true and no error', async () => {
    const { registry, pressed } = makePressableRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const events: NativeActionEvent[] = [];
    executor.onActionExecuted((e) => events.push(e));

    const result = await executor.executeAction('btn', { action: 'press' });

    expect(result.success).toBe(true);
    expect(pressed.count).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0].success).toBe(true);
    expect(events[0].error).toBeUndefined();
    expect(events[0].elementId).toBe('btn');
    expect(events[0].action).toBe('press');
  });

  it('fires listener on a failed action with success=false and error populated', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const events: NativeActionEvent[] = [];
    executor.onActionExecuted((e) => events.push(e));

    const result = await executor.executeAction('nonexistent-id', { action: 'click' });

    expect(result.success).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0].success).toBe(false);
    expect(events[0].error).toBeDefined();
    expect(events[0].error).toContain('nonexistent-id');
    expect(events[0].elementId).toBe('nonexistent-id');
    expect(events[0].action).toBe('click');
  });

  it('propagates requestId from the request into the event', async () => {
    const { registry } = makePressableRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const events: NativeActionEvent[] = [];
    executor.onActionExecuted((e) => events.push(e));

    await executor.executeAction('btn', { action: 'press', requestId: 'req-42' });

    expect(events[0].requestId).toBe('req-42');
  });

  it('reports a non-negative durationMs', async () => {
    const { registry } = makePressableRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const events: NativeActionEvent[] = [];
    executor.onActionExecuted((e) => events.push(e));

    await executor.executeAction('btn', { action: 'press' });

    expect(events[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(events[0].timestamp).toBeGreaterThan(0);
  });

  it('notifies multiple listeners on the same action', async () => {
    const { registry } = makePressableRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const a = vi.fn();
    const b = vi.fn();
    executor.onActionExecuted(a);
    executor.onActionExecuted(b);

    await executor.executeAction('btn', { action: 'press' });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('stops calling a listener after its disposer is invoked', async () => {
    const { registry } = makePressableRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const listener = vi.fn();
    const dispose = executor.onActionExecuted(listener);

    await executor.executeAction('btn', { action: 'press' });
    expect(listener).toHaveBeenCalledTimes(1);

    dispose();
    await executor.executeAction('btn', { action: 'press' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('isolates listener errors so other listeners still fire and the action still returns', async () => {
    const { registry } = makePressableRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const thrower = vi.fn(() => {
      throw new Error('boom');
    });
    const ok = vi.fn();
    executor.onActionExecuted(thrower);
    executor.onActionExecuted(ok);

    const result = await executor.executeAction('btn', { action: 'press' });

    expect(result.success).toBe(true);
    expect(thrower).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
