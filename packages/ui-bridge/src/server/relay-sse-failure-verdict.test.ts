/**
 * A failure a tab reports over the SSE transport keeps its verdict (plan
 * 2026-11-08-ui-bridge-relay-and-exec-mode-follow-ups-from-pr-329, Phase 2,
 * D2).
 *
 * The in-page relay client posts the dispatcher's whole `{ success: false, … }`
 * envelope as `result` to `POST <base>/commands` with `success: false`. Before
 * Phase 2 the Next.js adapter passed only the message on, so the relay answered
 * `UB-ACTION-FAILED` with the message and the dispatcher's own code and
 * `failureDetails` were lost. This drives the REAL settle path: the adapter's
 * `/commands` route over `createRelayHandlers`, with a fake tab that answers
 * each command by POSTing what the relay client posts.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { CommandRelay, type QueuedCommand } from './command-relay';
import { createNextRouteHandlers } from './nextjs';
import { createRelayHandlers } from './relay-handlers';

const ID = 'save-btn';

/** The dispatcher's returned not-found, exactly as `createActionFailure` builds it. */
const DISPATCHER_NOT_FOUND = {
  success: false,
  error: `Element ${ID} not found`,
  failureDetails: {
    errorCode: 'ELEMENT_NOT_FOUND',
    message: `Element ${ID} not found`,
    elementId: ID,
    selectorsTried: [`registry:${ID}`],
    suggestedActions: [],
    retryRecommended: false,
    durationMs: 1,
  },
  durationMs: 1,
  timestamp: 1700000000000,
};

/** The dispatcher's refusal of a mis-shaped `executeElementAction` payload. */
const DISPATCHER_INVALID_REQUEST = {
  success: false,
  error: 'executeElementAction needs an "action" string; got none.',
  failureDetails: {
    errorCode: 'INVALID_REQUEST',
    message: 'executeElementAction needs an "action" string; got none.',
    elementId: ID,
    selectorsTried: [],
    suggestedActions: [],
    retryRecommended: false,
    durationMs: 0,
  },
  durationMs: 0,
  timestamp: 1700000000000,
};

type Routes = ReturnType<typeof createNextRouteHandlers>;
type Route = (request: Request, context: { params: { path: string[] } }) => Promise<Response>;

const relays: CommandRelay[] = [];

afterEach(() => {
  for (const relay of relays.splice(0)) relay.destroy();
});

/** Call a route the way Next.js does, and read its JSON. */
async function call(
  routes: Routes,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const url = new URL(`https://app.test${path}`);
  const request = Object.assign(
    new Request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { nextUrl: url }
  );
  const route = (routes as unknown as Record<string, Route>)[method]!;
  const response = await route(request, {
    params: { path: url.pathname.slice(1).split('/') },
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

/**
 * A relay, its route handlers, and a fake tab on it that answers every
 * command by POSTing `answer(command)` to `/commands` as the in-page relay
 * client does (`relay-client.ts`, `sendResponse`): `success: false`, the
 * envelope as `result`, its `error` beside it. `posted` is `undefined` for a
 * post that carries no `result`. `heartbeat` makes the tab addressable by a
 * pinned read.
 */
function setup(
  answer: (command: QueuedCommand) => { posted?: unknown; error: string },
  options: { heartbeat?: boolean } = {}
): { routes: Routes; seen: string[] } {
  const relay = new CommandRelay({
    globalPrefix: `__uiBridgeSseVerdict_${Math.random().toString(36).slice(2, 10)}`,
    proactiveSnapshot: false,
  });
  relays.push(relay);
  const routes = createNextRouteHandlers(createRelayHandlers(relay), { relay });
  const seen: string[] = [];
  relay.subscribeToCommands((command) => {
    seen.push(command.action);
    const { posted, error } = answer(command);
    setTimeout(() => {
      void call(routes, 'POST', '/commands', {
        commandId: command.commandId,
        success: false,
        ...(posted !== undefined ? { result: posted } : {}),
        tabId: 'tab-a',
        error,
      });
    }, 0);
  }, 'tab-a');
  if (options.heartbeat) {
    relay.receiveHeartbeat('tab-a', { url: 'http://app.test/', title: 'a', visibility: 'visible' });
  }
  return { routes, seen };
}

describe('a failure a tab reports over SSE answers the tab’s own verdict', () => {
  it('(a) an unpinned getElement not-found answers UB-ELEM-NOT-FOUND with the posted envelope', async () => {
    const { routes, seen } = setup(() => ({
      posted: DISPATCHER_NOT_FOUND,
      error: DISPATCHER_NOT_FOUND.error,
    }));

    const { json } = await call(routes, 'GET', `/control/element/${ID}`);

    expect(seen).toEqual(['getElement']);
    expect(json).toEqual({
      success: false,
      error: `Element ${ID} not found`,
      code: 'UB-ELEM-NOT-FOUND',
      data: DISPATCHER_NOT_FOUND,
      timestamp: expect.any(Number),
    });
  });

  it('(b) the same read pinned with ?tabId= answers the same verdict', async () => {
    const { routes, seen } = setup(
      () => ({ posted: DISPATCHER_NOT_FOUND, error: DISPATCHER_NOT_FOUND.error }),
      { heartbeat: true }
    );

    const { json } = await call(routes, 'GET', `/control/element/${ID}?tabId=tab-a`);

    expect(seen).toEqual(['getElement']);
    expect(json).toEqual({
      success: false,
      error: `Element ${ID} not found`,
      code: 'UB-ELEM-NOT-FOUND',
      data: DISPATCHER_NOT_FOUND,
      timestamp: expect.any(Number),
    });
  });

  it('(c) a mis-shaped executeElementAction answers UB-VALIDATION-ERROR with its failureDetails', async () => {
    const { routes, seen } = setup(() => ({
      posted: DISPATCHER_INVALID_REQUEST,
      error: DISPATCHER_INVALID_REQUEST.error,
    }));

    const { json } = await call(routes, 'POST', `/control/element/${ID}/action`, {
      params: {},
    });

    expect(seen).toEqual(['executeElementAction']);
    expect(json).toEqual({
      success: false,
      error: 'executeElementAction needs an "action" string; got none.',
      code: 'UB-VALIDATION-ERROR',
      data: DISPATCHER_INVALID_REQUEST,
      timestamp: expect.any(Number),
    });
    expect((json.data as typeof DISPATCHER_INVALID_REQUEST).failureDetails.errorCode).toBe(
      'INVALID_REQUEST'
    );
  });

  it('(d) a post with no result answers UB-ACTION-FAILED and the message, as before', async () => {
    const { routes, seen } = setup(() => ({ error: `Element ${ID} not found` }));

    const { json } = await call(routes, 'GET', `/control/element/${ID}`);

    expect(seen).toEqual(['getElement']);
    expect(json).toEqual({
      success: false,
      error: `Element ${ID} not found`,
      code: 'UB-ACTION-FAILED',
      timestamp: expect.any(Number),
    });
  });
});
