import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import { NativeUIBridgeServer } from '../http-server';

/**
 * The HTTP status line must agree with the response envelope's `code`.
 *
 * Every unsuccessful `APIResponse` used to be flattened to HTTP 400
 * (`status: response.success ? 200 : 400`), so three genuinely different
 * outcomes were indistinguishable to a caller reading only the status:
 *
 *   - a route this platform deliberately does not implement (`NOT_SUPPORTED`)
 *   - a route that does not exist at all (`NOT_FOUND`)
 *   - a request that really was malformed (`INVALID_REQUEST`)
 *
 * The first two read as "you sent a bad request", which sent operators
 * retrying request shapes against endpoints that were never going to answer.
 */

interface ParsedResponse {
  success: boolean;
  error?: string;
  code?: string;
  timestamp: number;
}

function buildServer() {
  const registry = new NativeUIBridgeRegistry();
  const executor = new DefaultNativeActionExecutor(registry);
  return new NativeUIBridgeServer(registry, executor);
}

async function probe(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown
): Promise<{ status: number; parsed: ParsedResponse }> {
  const server = buildServer();
  const res = await server.handleRequest({ method, path, headers: {}, query: {}, body });
  return { status: res.status, parsed: JSON.parse(res.body) as ParsedResponse };
}

describe('HTTP status mapping — the status line matches the envelope code', () => {
  it('maps NOT_SUPPORTED to 501', async () => {
    const { status, parsed } = await probe('GET', '/ui-bridge/ai/forms');
    expect(parsed.code).toBe('NOT_SUPPORTED');
    expect(status).toBe(501);
  });

  it('maps NOT_FOUND to 404 for a route that is not registered', async () => {
    // `control/visibility` is documented by two skill files but implemented by
    // no SDK on any platform, so it is the real-world NOT_FOUND this mapping
    // exists to make legible. It used to answer 400 while carrying
    // `code: "NOT_FOUND"`.
    const { status, parsed } = await probe('POST', '/ui-bridge/control/visibility', {
      minRatio: 0.02,
    });
    expect(parsed.code).toBe('NOT_FOUND');
    expect(status).toBe(404);
  });

  it('maps NOT_FOUND to 404 for a path outside the /ui-bridge/ prefix', async () => {
    const { status, parsed } = await probe('GET', '/nope');
    expect(parsed.code).toBe('NOT_FOUND');
    expect(status).toBe(404);
  });

  it('maps METHOD_NOT_ALLOWED to 405 when the pattern matches but the verb does not', async () => {
    const { status, parsed } = await probe('POST', '/ui-bridge/health', {});
    expect(parsed.code).toBe('METHOD_NOT_ALLOWED');
    expect(status).toBe(405);
  });

  it('keeps 400 for a genuinely malformed request', async () => {
    const { status, parsed } = await probe('POST', '/ui-bridge/control/page/click-by-text', {});
    expect(parsed.code).toBe('INVALID_REQUEST');
    expect(status).toBe(400);
  });

  it('still returns 500 when a handler throws — the mapping does not swallow it', async () => {
    const server = buildServer();
    // Force the routed handler to throw; `handleRequest`'s catch owns this.
    const handlers = (server as unknown as { handlers: Record<string, unknown> }).handlers;
    handlers.health = () => {
      throw new Error('handler exploded');
    };

    const res = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/health',
      headers: {},
      query: {},
    });
    expect(res.status).toBe(500);
    const parsed = JSON.parse(res.body) as ParsedResponse;
    expect(parsed.code).toBe('INTERNAL_ERROR');
  });

  it('keeps 200 for a successful response', async () => {
    const { status, parsed } = await probe('GET', '/ui-bridge/health');
    expect(parsed.success).toBe(true);
    expect(status).toBe(200);
  });
});
