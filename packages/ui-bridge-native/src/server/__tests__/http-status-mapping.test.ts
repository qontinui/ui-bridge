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

function buildServer(config?: Record<string, unknown>) {
  const registry = new NativeUIBridgeRegistry();
  const executor = new DefaultNativeActionExecutor(registry);
  return new NativeUIBridgeServer(registry, executor, config as never);
}

async function probe(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  config?: Record<string, unknown>
): Promise<{ status: number; parsed: ParsedResponse; headers: Record<string, string> }> {
  const server = buildServer(config);
  const res = await server.handleRequest({ method, path, headers: {}, query: {}, body });
  return {
    status: res.status,
    parsed: JSON.parse(res.body) as ParsedResponse,
    headers: res.headers,
  };
}

describe('HTTP status mapping — the status line matches the envelope code', () => {
  it('maps NOT_SUPPORTED to 501', async () => {
    const { status, parsed } = await probe('GET', '/ui-bridge/ai/forms');
    expect(parsed.code).toBe('NOT_SUPPORTED');
    expect(status).toBe(501);
  });

  it('maps NOT_FOUND to 404 for a route that is not registered', async () => {
    // `control/visibility` is implemented by the WEB SDK in this same repo
    // (`packages/ui-bridge`: the `visibility` handler, its relay twin, and the
    // route entry in `types.ts`) — but NOT here, and not by the runner's Rust
    // route table on `:9876` either. So it is the real-world NOT_FOUND this
    // mapping exists to make legible: a route that genuinely exists on another
    // platform and genuinely does not exist on this one. It used to answer 400
    // while carrying `code: "NOT_FOUND"`.
    //
    // This assertion pins the ABSENCE deliberately. Should React Native ever
    // grow the route, this test is the thing that must change first.
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

/**
 * A 405 without `Allow` tells the caller its verb was wrong and not which verb
 * is right — the same guessing game the blanket 400 caused, one status code
 * later. RFC 9110 §15.5.6 makes the header mandatory on a 405, and the verbs are
 * read off `WS_ROUTES`, the array `routeRequest` itself iterates, so the header
 * and the status cannot come to disagree about what this surface accepts.
 *
 * Mirrored on the sibling surface (`packages/ui-bridge/src/native/server/
 * http-status-mapping.test.ts`). The status mapping is pinned equal across the
 * two packages by `http-status-parity.test.ts`; this header is not, because the
 * two serve genuinely different route sets — but a wrong-verb answer that names
 * its verbs on one surface and not the other would re-open exactly the
 * divergence #175 and #189 closed.
 */
describe('the 405 says which verbs ARE allowed', () => {
  it('names the published verb for a wrong-verb request', async () => {
    const { status, parsed, headers } = await probe('POST', '/ui-bridge/health', {});
    expect(status).toBe(405);
    expect(headers.Allow).toBe('GET');
    // In the ENVELOPE too. Almost nothing in this tree reads headers — the
    // skills, the cheatsheets and every documented probe read the JSON body —
    // so a header-only fix would be invisible to the likeliest caller.
    expect(parsed.error).toBe('Method not allowed: POST /ui-bridge/health (allowed: GET)');
  });

  it('makes Allow readable cross-origin when CORS is on', async () => {
    // `Allow` is not a CORS-safelisted response header, so without
    // `Access-Control-Expose-Headers` a browser caller reads `null` from it —
    // the guessing game this is meant to end, for exactly the caller class that
    // needs a served route table most.
    const on = await probe('POST', '/ui-bridge/health', {}, { cors: true });
    expect(on.headers['Access-Control-Expose-Headers']).toBe('Allow');

    const off = await probe('POST', '/ui-bridge/health', {}, { cors: false });
    expect(off.headers.Allow).toBe('GET');
    expect(off.headers['Access-Control-Expose-Headers']).toBeUndefined();
  });

  it('names every verb a multi-verb route accepts', async () => {
    // `control/page-health` is mounted GET+POST so the canonical skill
    // invocation and an ad-hoc curl both work. A caller sent here by a 405 has
    // to be told about both, or the header would be worse than the body.
    const { status, headers } = await probe('DELETE', '/ui-bridge/control/page-health', {});
    expect(status).toBe(405);
    expect(headers.Allow).toBe('GET, POST');
  });

  it('does not advertise a testHooks-gated verb on a production build', async () => {
    // With the flag off `control/keep-awake` is not mounted at all, so the
    // honest answer is 404 with no `Allow` — advertising POST there would point
    // a caller at a route this build will never serve.
    const off = await probe('GET', '/ui-bridge/control/keep-awake');
    expect(off.status).toBe(404);
    expect(off.headers.Allow).toBeUndefined();

    const on = await probe('GET', '/ui-bridge/control/keep-awake', undefined, {
      testHooks: true,
    });
    expect(on.status).toBe(405);
    expect(on.headers.Allow).toBe('POST');
  });

  it('treats a wrong verb on a discovery endpoint as 405, not 404', async () => {
    // `_help` and `_routes` are served by an inline special case rather than
    // through `WS_ROUTES`, so the wrong-verb loop cannot see them. `POST
    // /ui-bridge/_routes` used to answer "no such route" about a route that
    // `buildRoutesPayload` publishes, and `UI_BRIDGE_NATIVE_ROUTES` now
    // publishes too.
    const { status, parsed, headers } = await probe('POST', '/ui-bridge/_routes', {});
    expect(parsed.code).toBe('METHOD_NOT_ALLOWED');
    expect(status).toBe(405);
    expect(headers.Allow).toBe('GET');

    const help = await probe('POST', '/ui-bridge/_help', {});
    expect(help.status).toBe(405);
    expect(help.headers.Allow).toBe('GET');
  });

  it('sets no Allow header on a 404, where it would mean nothing', async () => {
    const { status, headers } = await probe('POST', '/ui-bridge/control/visibility', {});
    expect(status).toBe(404);
    expect(headers.Allow).toBeUndefined();
  });

  it('sets no Allow header on a 200', async () => {
    const { status, headers } = await probe('GET', '/ui-bridge/health');
    expect(status).toBe(200);
    expect(headers.Allow).toBeUndefined();
  });
});
