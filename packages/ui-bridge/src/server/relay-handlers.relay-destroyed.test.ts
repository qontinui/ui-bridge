/**
 * A command whose `CommandRelay` is destroyed while it is in flight settles
 * with `RelayDestroyedError` (code `RELAY_DESTROYED`), which exists so a
 * caller can tell "the relay went away" from "the page never answered". These
 * tests pin that the HTTP layer keeps that distinction: the literal
 * `RELAY_DESTROYED` code and a 503, never the generic `COMMAND_FAILED` with an
 * "open the app" hint (which a destroyed relay, having forgotten every
 * listener, would otherwise get), and never a fallback default dressed as a
 * healthy answer.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandRelay, RelayDestroyedError } from './command-relay';
import { createRelayHandlers } from './relay-handlers';
import { createNextRouteHandlers } from './nextjs';

const relays: CommandRelay[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const relay of relays.splice(0)) relay.destroy();
});

function freshRelay(): CommandRelay {
  const relay = new CommandRelay({
    globalPrefix: `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`,
    proactiveSnapshot: false,
  });
  relays.push(relay);
  return relay;
}

/** Subscribe a tab that never answers, resolving once a command reaches it. */
function silentTab(relay: CommandRelay, tabId: string): Promise<void> {
  return new Promise((resolve) => {
    relay.subscribeToCommands(() => resolve(), tabId);
  });
}

const BASE = '/api/ui-bridge';

function post(routes: ReturnType<typeof createNextRouteHandlers>, path: string, body: unknown) {
  const url = `http://app.test${BASE}${path}`;
  const nextUrl = new URL(url);
  const request = Object.assign(
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { nextUrl }
  );
  return routes.POST(
    request as never,
    {
      params: { path: nextUrl.pathname.slice(BASE.length + 1) },
    } as never
  );
}

describe('relay-handlers · a relay destroyed under a command', () => {
  it('answers RELAY_DESTROYED with httpStatus 503, not COMMAND_FAILED', async () => {
    const relay = freshRelay();
    const delivered = silentTab(relay, 'tab-a');
    const handlers = createRelayHandlers(relay);

    const pending = handlers.executeElementAction!('foo', {
      action: 'click',
    } as unknown as Parameters<typeof handlers.executeElementAction>[1]);
    await delivered;
    relay.destroy();
    const result = await pending;

    expect(result.success).toBe(false);
    expect(result.code).toBe('RELAY_DESTROYED');
    expect((result as { httpStatus?: number }).httpStatus).toBe(503);
    // The listener check would have said this; the page is not the problem.
    expect(result.error).not.toContain('No browser tab is connected');
  });

  it('a fallback read does not answer a destroyed relay with its default', async () => {
    const relay = freshRelay();
    vi.spyOn(relay, 'queueCommand').mockRejectedValue(new RelayDestroyedError());
    const handlers = createRelayHandlers(relay);

    const result = await handlers.getStates!();

    expect(result.success).toBe(false);
    expect(result.code).toBe('RELAY_DESTROYED');
    expect((result as { httpStatus?: number }).httpStatus).toBe(503);
  });

  it('console errors and the semantic snapshot do not answer from cache or empty', async () => {
    const relay = freshRelay();
    const spy = vi.spyOn(relay, 'queueCommand');
    const handlers = createRelayHandlers(relay);

    // Prime both caches with a live answer first.
    spy.mockResolvedValueOnce({ errors: [{ message: 'boom' }], count: 1 } as unknown);
    expect((await handlers.getConsoleErrors!()).success).toBe(true);
    spy.mockResolvedValueOnce({ elements: [] } as unknown);
    expect((await handlers.getSemanticSnapshot!()).success).toBe(true);

    spy.mockRejectedValue(new RelayDestroyedError());
    for (const result of [
      await handlers.getConsoleErrors!(),
      await handlers.getConsoleErrors!({ group: true } as never),
      await handlers.getSemanticSnapshot!(),
    ]) {
      expect(result.success).toBe(false);
      expect(result.code).toBe('RELAY_DESTROYED');
      expect((result as { httpStatus?: number }).httpStatus).toBe(503);
    }
  });

  it('a fallback read still answers its default for an ordinary failure', async () => {
    const relay = freshRelay();
    vi.spyOn(relay, 'queueCommand').mockRejectedValue(new Error('Command getStates timed out'));
    const handlers = createRelayHandlers(relay);

    const result = await handlers.getStates!();

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
    expect((result._meta as { fallback?: boolean } | undefined)?.fallback).toBe(true);
  });

  it('the Next.js adapter turns it into an HTTP 503', async () => {
    const relay = freshRelay();
    vi.spyOn(relay, 'queueCommand').mockRejectedValue(new RelayDestroyedError());
    const routes = createNextRouteHandlers(createRelayHandlers(relay));

    const response = await post(routes, '/control/element/foo/action', { action: 'click' });

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe('RELAY_DESTROYED');
    expect(body.httpStatus).toBeUndefined();
  });

  for (const verb of ['close', 'activate'] as const) {
    it(`the Next.js /tabs/:id/${verb} route answers 503 RELAY_DESTROYED`, async () => {
      const relay = freshRelay();
      vi.spyOn(relay, 'queueCommand').mockRejectedValue(new RelayDestroyedError());
      const routes = createNextRouteHandlers(createRelayHandlers(relay), { relay });

      const response = await post(routes, `/tabs/tab-a/${verb}`, {});

      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.code).toBe('RELAY_DESTROYED');
    });
  }
});
