/**
 * The HTTP status line must agree with the response envelope's `code`.
 *
 * Post-merge follow-up to qontinui/ui-bridge#175, which fixed exactly this in
 * the sibling package (`@qontinui/ui-bridge-native`) and recorded in its own PR
 * body that the same bug was left standing here — "the two surfaces now answer
 * differently". Plan
 * `2026-08-27-mobile-relay-followups-observability-and-sdk-contracts`, Phase 4.
 *
 * `@qontinui/ui-bridge/native` flattened every unsuccessful `APIResponse` to
 * HTTP 400 (`status: response.success ? 200 : 400`), so three genuinely
 * different outcomes were indistinguishable to a caller reading only the
 * status:
 *
 *   - a route this platform deliberately does not implement (`NOT_SUPPORTED`)
 *   - a route that does not exist at all (`NOT_FOUND`)
 *   - a request that really was malformed (`ELEMENT_NOT_FOUND` and friends)
 *
 * The first two read as "you sent a bad request", which sends operators
 * retrying request shapes against endpoints that were never going to answer.
 *
 * Ported alongside the code, as Phase 4 requires: this surface had no test
 * asserting either status.
 */

import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../core/registry';
import { NativeUIBridgeServer, httpStatusForResponse } from './http-server';

interface ParsedResponse {
  success: boolean;
  error?: string;
  code?: string;
  timestamp: number;
}

/**
 * A stub executor — every assertion here is about routing and status, and no
 * test in this file reaches an action. Same shape as the one in
 * `batch-skipped-step.followup.test.ts`, and it keeps `react-native` out of
 * the test transformer's path.
 */
function stubExecutor() {
  return {
    executeAction: async () => ({ success: true, durationMs: 0, timestamp: 0 }),
    executeComponentAction: async () => ({ success: true, durationMs: 0, timestamp: 0 }),
  };
}

function buildServer(): NativeUIBridgeServer {
  return new NativeUIBridgeServer(new NativeUIBridgeRegistry(), stubExecutor() as never);
}

async function probe(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown
): Promise<{ status: number; parsed: ParsedResponse }> {
  const res = await buildServer().handleRequest({ method, path, headers: {}, query: {}, body });
  return { status: res.status, parsed: JSON.parse(res.body) as ParsedResponse };
}

describe('HTTP status mapping — the status line matches the envelope code', () => {
  it('maps NOT_SUPPORTED to 501 on a page-navigation stub', async () => {
    const { status, parsed } = await probe('POST', '/ui-bridge/control/page/refresh', {});
    expect(parsed.code).toBe('NOT_SUPPORTED');
    expect(status).toBe(501);
  });

  it('maps NOT_FOUND to 404 for a route that is not registered', async () => {
    const { status, parsed } = await probe('POST', '/ui-bridge/control/visibility', {
      minRatio: 0.02,
    });
    expect(parsed.code).toBe('NOT_FOUND');
    expect(status).toBe(404);
  });

  it('maps NOT_FOUND to 404 for a path matching no published route at all', async () => {
    // NB: this router has no `/ui-bridge/` prefix guard (the sibling does).
    // `/nope` 404s by falling off the end of the `if` chain, which is the same
    // mechanism as the case above — not a separate structural check.
    const { status, parsed } = await probe('GET', '/nope');
    expect(parsed.code).toBe('NOT_FOUND');
    expect(status).toBe(404);
  });

  it('maps METHOD_NOT_ALLOWED to 405 when the path is published under another verb', async () => {
    // `/ui-bridge/health` is a published GET. Asking for it with POST is a
    // wrong-verb request, not a nonexistent route, and it used to answer 404
    // here while the sibling answered 405 for the identical request — the very
    // cross-surface divergence this change exists to close. The verb table is
    // read off `UI_BRIDGE_NATIVE_ROUTES` rather than re-declared.
    const { status, parsed } = await probe('POST', '/ui-bridge/health', {});
    expect(parsed.code).toBe('METHOD_NOT_ALLOWED');
    expect(status).toBe(405);
  });

  it('does not turn an unpublished path into 405 just because a verb differs', async () => {
    // The negative control for the branch above: `control/visibility` is
    // published by neither verb, so it must stay a 404 rather than becoming a
    // blanket "wrong method" answer.
    const { status, parsed } = await probe('GET', '/ui-bridge/control/visibility');
    expect(parsed.code).toBe('NOT_FOUND');
    expect(status).toBe(404);
  });

  it('keeps 400 for a resource-level miss — the id named nothing, the route resolved', async () => {
    const { status, parsed } = await probe('GET', '/ui-bridge/control/element/no-such-id');
    expect(parsed.code).toBe('ELEMENT_NOT_FOUND');
    expect(status).toBe(400);
  });

  it('still returns 500 when a handler throws — the mapping does not swallow it', async () => {
    const server = buildServer();
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
    expect((JSON.parse(res.body) as ParsedResponse).code).toBe('INTERNAL_ERROR');
  });

  it('keeps 200 for a successful response', async () => {
    const { status, parsed } = await probe('GET', '/ui-bridge/health');
    expect(parsed.success).toBe(true);
    expect(status).toBe(200);
  });
});

describe('httpStatusForResponse in isolation', () => {
  it('falls back to 400 for an unmapped code, and for no code at all', () => {
    expect(httpStatusForResponse({ success: false, code: 'ACTION_FAILED', timestamp: 0 })).toBe(
      400
    );
    expect(httpStatusForResponse({ success: false, timestamp: 0 })).toBe(400);
  });

  it('does not resolve an inherited object key to a status', () => {
    // The reason the table is a `Map`: a plain object literal would resolve
    // `"constructor"` to a function where a number is typed.
    expect(httpStatusForResponse({ success: false, code: 'constructor', timestamp: 0 })).toBe(400);
    expect(httpStatusForResponse({ success: false, code: 'toString', timestamp: 0 })).toBe(400);
  });
});
