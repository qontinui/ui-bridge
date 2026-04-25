import { describe, it, expect, vi } from 'vitest';
import { ApiTransport } from '../src/transports/api.js';
import { WrapperTransportError } from '../src/types.js';

describe('ApiTransport', () => {
  it('round-trips through the handler registry', async () => {
    const transport = new ApiTransport({ kind: 'api' });
    transport.handlerRegistry.register('greet', (params: unknown) => {
      const { name } = params as { name: string };
      return `hello, ${name}`;
    });

    const result = await transport.dispatch<string>('greet', { name: 'world' });
    expect(result).toBe('hello, world');
    expect(transport.status).toBe('ready');
  });

  it('passes an { kind: "api" } ctx object to handlers', async () => {
    const transport = new ApiTransport({ kind: 'api' });
    let seenCtx: unknown = null;
    transport.handlerRegistry.register('probe', (_params: unknown, ctx: unknown) => {
      seenCtx = ctx;
      return true;
    });

    await transport.dispatch('probe');
    expect(seenCtx).toEqual({ kind: 'api' });
  });

  it('fires onStatusChange transitions idle → connecting → ready → closed', async () => {
    const transport = new ApiTransport({ kind: 'api' });
    const seen: string[] = [];
    const off = transport.onStatusChange((s) => seen.push(s));

    await transport.ready();
    await transport.close();
    off();

    expect(seen).toEqual(['connecting', 'ready', 'closed']);
  });

  it('falls back to options.handler when no registry entry exists', async () => {
    const handler = vi.fn(async (_action: string, params: unknown) => {
      return { wrapped: params };
    });
    const transport = new ApiTransport({ kind: 'api', options: { handler } });

    const result = await transport.dispatch('unknown', { a: 1 });
    expect(result).toEqual({ wrapped: { a: 1 } });
    expect(handler).toHaveBeenCalledWith('unknown', { a: 1 });
  });

  it('prefers the registered handler over options.handler', async () => {
    const fallback = vi.fn();
    const transport = new ApiTransport({
      kind: 'api',
      options: { handler: fallback },
    });
    transport.handlerRegistry.register('known', () => 'from-registry');

    const result = await transport.dispatch<string>('known');
    expect(result).toBe('from-registry');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('throws NO_HANDLER when nothing matches and no fallback is set', async () => {
    const transport = new ApiTransport({ kind: 'api' });
    try {
      await transport.dispatch('missing');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(WrapperTransportError);
      expect((err as WrapperTransportError).code).toBe('NO_HANDLER');
    }
  });

  it('wraps fallback errors as HANDLER_ERROR', async () => {
    const transport = new ApiTransport({
      kind: 'api',
      options: {
        handler: async () => {
          throw new Error('fallback bug');
        },
      },
    });

    try {
      await transport.dispatch('anything');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(WrapperTransportError);
      expect((err as WrapperTransportError).code).toBe('HANDLER_ERROR');
      expect((err as WrapperTransportError).message).toBe('fallback bug');
    }
  });

  it('rejects dispatch after close with TRANSPORT_CLOSED', async () => {
    const transport = new ApiTransport({ kind: 'api' });
    transport.handlerRegistry.register('x', () => 1);
    await transport.ready();
    await transport.close();
    await expect(transport.dispatch('x')).rejects.toMatchObject({
      code: 'TRANSPORT_CLOSED',
    });
  });
});
