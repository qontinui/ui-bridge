import { describe, it, expect } from 'vitest';
import { HandlerRegistry } from '../src/handler-registry.js';
import { WrapperTransportError } from '../src/types.js';

describe('HandlerRegistry', () => {
  it('dispatches to a registered handler (happy path)', async () => {
    const registry = new HandlerRegistry();
    registry.register('echo', (params: unknown) => ({ got: params }));

    const result = await registry.dispatch('echo', { hi: 1 });
    expect(result).toEqual({ got: { hi: 1 } });
  });

  it('awaits an async handler', async () => {
    const registry = new HandlerRegistry();
    registry.register('slow', async (_params: unknown, _ctx: unknown) => {
      await new Promise((r) => setTimeout(r, 5));
      return 42;
    });

    const result = await registry.dispatch<number>('slow');
    expect(result).toBe(42);
  });

  it('throws WrapperTransportError(NO_HANDLER) for unregistered actions', async () => {
    const registry = new HandlerRegistry();
    await expect(registry.dispatch('missing')).rejects.toBeInstanceOf(WrapperTransportError);
    await expect(registry.dispatch('missing')).rejects.toMatchObject({
      code: 'NO_HANDLER',
    });
  });

  it('wraps thrown handler errors as HANDLER_ERROR and preserves cause', async () => {
    const registry = new HandlerRegistry();
    const boom = new Error('nope');
    registry.register('fail', () => {
      throw boom;
    });

    try {
      await registry.dispatch('fail');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(WrapperTransportError);
      expect((err as WrapperTransportError).code).toBe('HANDLER_ERROR');
      expect((err as WrapperTransportError).message).toBe('nope');
      expect((err as WrapperTransportError).cause).toBe(boom);
    }
  });

  it('passes WrapperTransportError through without re-wrapping', async () => {
    const registry = new HandlerRegistry();
    const original = new WrapperTransportError('CUSTOM', 'custom message', {
      retryable: true,
    });
    registry.register('raise', () => {
      throw original;
    });

    try {
      await registry.dispatch('raise');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBe(original);
    }
  });

  it('supports unregister + list + has', () => {
    const registry = new HandlerRegistry();
    registry.register('a', () => 1);
    registry.register('b', () => 2);
    expect(registry.list()).toEqual(['a', 'b']);
    expect(registry.has('a')).toBe(true);
    expect(registry.unregister('a')).toBe(true);
    expect(registry.unregister('a')).toBe(false);
    expect(registry.has('a')).toBe(false);
  });

  it('forwards ctx to handlers', async () => {
    const registry = new HandlerRegistry();
    registry.register('ctx-check', (_params: unknown, ctx: unknown) => ctx);
    const result = await registry.dispatch('ctx-check', undefined, { tag: 'x' });
    expect(result).toEqual({ tag: 'x' });
  });
});
