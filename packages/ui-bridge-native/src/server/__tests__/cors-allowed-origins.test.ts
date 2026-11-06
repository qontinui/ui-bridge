import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import { NativeUIBridgeServer } from '../http-server';

/**
 * `Access-Control-Allow-Origin` carries one origin or `*`. With two or more
 * `allowedOrigins` the server used to send them comma-joined, which a browser
 * rejects, so no listed origin could read a response. The request's `Origin`
 * is echoed when listed, nothing is granted when it is not, and `Vary: Origin`
 * keeps one origin's grant out of another's cache.
 */

const A = 'http://a.example';
const B = 'http://b.example';

async function corsFor(origin: string | undefined, method = 'OPTIONS') {
  const registry = new NativeUIBridgeRegistry();
  const server = new NativeUIBridgeServer(registry, new DefaultNativeActionExecutor(registry), {
    cors: true,
    allowedOrigins: [A, B],
  } as never);
  const res = await server.handleRequest({
    method,
    path: '/ui-bridge/control/elements',
    headers: origin ? { Origin: origin } : {},
    query: {},
  });
  return res.headers;
}

describe('native CORS with several allowedOrigins', () => {
  it('echoes each listed origin on its own', async () => {
    for (const origin of [A, B]) {
      const headers = await corsFor(origin);
      expect(headers['Access-Control-Allow-Origin']).toBe(origin);
      expect(headers['Vary']).toBe('Origin');
    }
  });

  it('echoes the origin on an ordinary request as well as a preflight', async () => {
    expect((await corsFor(B, 'GET'))['Access-Control-Allow-Origin']).toBe(B);
  });

  it('grants nothing to an origin that is not listed, or to none at all', async () => {
    for (const origin of ['http://evil.example', undefined]) {
      const headers = await corsFor(origin);
      expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
      expect(headers['Vary']).toBe('Origin');
    }
  });

  it('still answers * when no allowedOrigins are configured', async () => {
    const registry = new NativeUIBridgeRegistry();
    const server = new NativeUIBridgeServer(registry, new DefaultNativeActionExecutor(registry), {
      cors: true,
    } as never);
    const res = await server.handleRequest({
      method: 'OPTIONS',
      path: '/ui-bridge/control/elements',
      headers: { origin: A },
      query: {},
    });
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  it('answers * when allowedOrigins holds *', async () => {
    const registry = new NativeUIBridgeRegistry();
    const server = new NativeUIBridgeServer(registry, new DefaultNativeActionExecutor(registry), {
      cors: true,
      allowedOrigins: ['*'],
    } as never);
    const res = await server.handleRequest({
      method: 'OPTIONS',
      path: '/ui-bridge/control/elements',
      headers: { origin: A },
      query: {},
    });
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
  });
});
