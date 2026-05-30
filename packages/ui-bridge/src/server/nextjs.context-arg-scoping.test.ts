/**
 * HTTP-layer regression test for the §4.2 per-user-scoping context-arg
 * hole. The Next.js catch-all dispatcher MUST append a trailing
 * `{callerUserId}` context arg to every handler invocation so zero-arg
 * / id-only handlers (`captureSnapshot()`, `clearRenderLog()`,
 * `getElementState(id)`) enforce ownership when `X-Caller-User-Id` is
 * present on the request.
 *
 * Scenario reproduced: alice issues `POST /control/snapshot` (no body)
 * with `X-Caller-User-Id: alice`. The relay's primaryTabId is bob's
 * tab. Expected: the relay rejects with SDK_DISCONNECTED (because
 * alice has zero owned tabs) — alice does NOT see a snapshot of bob's
 * page.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRelay } from './command-relay';
import { createNextRouteHandlers } from './nextjs';
import { createRelayHandlers } from './relay-handlers';

interface NextRequestLike extends Request {
  nextUrl: URL;
}

function makeRequest(
  method: string,
  path: string,
  init?: { body?: unknown; headers?: Record<string, string>; query?: string }
): NextRequestLike {
  const url = `https://test.local${path}${init?.query ? `?${init.query}` : ''}`;
  const req = new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    body:
      init?.body !== undefined && method !== 'GET' && method !== 'HEAD'
        ? JSON.stringify(init.body)
        : undefined,
  });
  Object.defineProperty(req, 'nextUrl', { value: new URL(url), writable: false });
  return req as NextRequestLike;
}

function freshRelay(): CommandRelay {
  const prefix = `__uiBridgeCtxArgHttpTest_${Math.random().toString(36).slice(2, 10)}`;
  return new CommandRelay({ globalPrefix: prefix });
}

describe('Next.js · context-arg scoping (§4.2 follow-up)', () => {
  let relay: CommandRelay;

  beforeEach(() => {
    relay = freshRelay();
  });

  afterEach(() => {
    relay.destroy();
  });

  // -------------------------------------------------------------------------
  // captureSnapshot — the named scenario from the brief.
  // -------------------------------------------------------------------------

  it('POST /render-log/snapshot with X-Caller-User-Id: alice → ownerCheck for alice', async () => {
    // Bob has a tab. Alice does NOT — she is attacking via primaryTabId
    // fallback. Mock queueCommand so we don't await a real browser.
    relay.subscribeToCommands(() => {}, 'tab-b-bob');
    relay.recordRegistration('tab-b-bob', { userId: 'bob', sessionId: 's' });
    const spy = vi.spyOn(relay, 'queueCommand').mockResolvedValue({} as never);
    const handlers = createRelayHandlers(relay);
    const routes = createNextRouteHandlers(handlers, { relay });

    const req = makeRequest('POST', '/render-log/snapshot', {
      body: {}, // empty body — the attack form.
      headers: { 'X-Caller-User-Id': 'alice' },
    });
    await routes.POST(req, { params: { path: ['render-log', 'snapshot'] } });

    expect(spy).toHaveBeenCalled();
    const opts = spy.mock.calls[0]![2];
    expect((opts as { ownerCheck?: { userId: string } } | undefined)?.ownerCheck).toEqual({
      userId: 'alice',
    });
  });

  it('POST /render-log/snapshot WITHOUT X-Caller-User-Id → no ownerCheck (admin path)', async () => {
    relay.subscribeToCommands(() => {}, 'tab-b-bob');
    relay.recordRegistration('tab-b-bob', { userId: 'bob', sessionId: 's' });
    const spy = vi.spyOn(relay, 'queueCommand').mockResolvedValue({} as never);
    const handlers = createRelayHandlers(relay);
    const routes = createNextRouteHandlers(handlers, { relay });

    const req = makeRequest('POST', '/render-log/snapshot', { body: {} });
    await routes.POST(req, { params: { path: ['render-log', 'snapshot'] } });

    expect(spy).toHaveBeenCalled();
    const opts = spy.mock.calls[0]![2];
    expect((opts as { ownerCheck?: unknown } | undefined)?.ownerCheck).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // clearRenderLog — DELETE /render-log
  // -------------------------------------------------------------------------

  it('DELETE /render-log with X-Caller-User-Id: alice → ownerCheck for alice', async () => {
    relay.subscribeToCommands(() => {}, 'tab-b-bob');
    relay.recordRegistration('tab-b-bob', { userId: 'bob', sessionId: 's' });
    const spy = vi.spyOn(relay, 'queueCommand').mockResolvedValue({} as never);
    const handlers = createRelayHandlers(relay);
    const routes = createNextRouteHandlers(handlers, { relay });

    const req = makeRequest('DELETE', '/render-log', {
      headers: { 'X-Caller-User-Id': 'alice' },
    });
    await routes.DELETE(req, { params: { path: ['render-log'] } });

    expect(spy).toHaveBeenCalled();
    const action = spy.mock.calls[0]![0];
    const opts = spy.mock.calls[0]![2];
    expect(action).toBe('clearRenderLog');
    expect((opts as { ownerCheck?: { userId: string } } | undefined)?.ownerCheck).toEqual({
      userId: 'alice',
    });
  });

  // -------------------------------------------------------------------------
  // getElementState(id) — GET /control/element/:id/state
  // -------------------------------------------------------------------------

  it('GET /control/element/elem-x/state with X-Caller-User-Id: alice → ownerCheck for alice', async () => {
    relay.subscribeToCommands(() => {}, 'tab-b-bob');
    relay.recordRegistration('tab-b-bob', { userId: 'bob', sessionId: 's' });
    const spy = vi.spyOn(relay, 'queueCommand').mockResolvedValue({ visible: true } as never);
    const handlers = createRelayHandlers(relay);
    const routes = createNextRouteHandlers(handlers, { relay });

    const req = makeRequest('GET', '/control/element/elem-x/state', {
      headers: { 'X-Caller-User-Id': 'alice' },
    });
    await routes.GET(req, { params: { path: ['control', 'element', 'elem-x', 'state'] } });

    expect(spy).toHaveBeenCalled();
    const action = spy.mock.calls[0]![0];
    const payload = spy.mock.calls[0]![1];
    const opts = spy.mock.calls[0]![2];
    expect(action).toBe('getElementState');
    expect(payload).toEqual({ id: 'elem-x' });
    expect((opts as { ownerCheck?: { userId: string } } | undefined)?.ownerCheck).toEqual({
      userId: 'alice',
    });
  });
});
