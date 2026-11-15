/**
 * The instrument-unavailable prefix contract, end to end — plan
 * 2026-11-08-ui-bridge-relay-client-drops-refused-results-and-heartbeats-silently,
 * Phase 8 (D3), review fix n5.
 *
 * `server/relay-handlers.ts` recognises a tab's "cannot measure" by the code
 * leading the failure's message, because the result route hands
 * `rejectCommand` the message alone. This test does not hand-copy that
 * message: it runs the REAL in-page dispatcher (`executeCommand`) with no
 * console capture in the realm, posts its actual answer to the Next.js
 * `POST /commands` route in the body shape the relay client sends
 * (`relay/relay-client.ts` `sendResponse`: `success:false`, `result`,
 * `error: result.error`), and reads the HTTP answer of the caller's
 * `GET /control/console-errors`. If either side drifts — the page's message
 * format or the server's prefix match — `CAPTURE_UNAVAILABLE` stops coming out.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';
import { createNextRouteHandlers } from './nextjs';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';

const BASE = '/api/ui-bridge';
type Routes = ReturnType<typeof createNextRouteHandlers>;

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

function call(
  routes: Routes,
  method: 'GET' | 'POST',
  path: string,
  options: { caller?: string; body?: unknown; signal?: AbortSignal } = {}
): Promise<Response> {
  const url = `http://app.test${BASE}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.caller) headers['X-Caller-User-Id'] = options.caller;
  const init: RequestInit = { method, headers, signal: options.signal };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  const nextUrl = new URL(url);
  const request = Object.assign(new Request(url, init), { nextUrl });
  return routes[method](request as never, {
    params: { path: nextUrl.pathname.slice(BASE.length + 1).split('?')[0] },
  });
}

interface Tab {
  streamId: () => string | undefined;
  command: (action: string) => Promise<{ commandId: string; payload: unknown }>;
  close: () => void;
}

/** An open command stream, as a browser tab holds one (SSE frames parsed). */
async function openTab(routes: Routes, tabId: string, caller: string): Promise<Tab> {
  const controller = new AbortController();
  const response = await call(routes, 'GET', `/commands/stream?tabId=${tabId}`, {
    caller,
    signal: controller.signal,
  });
  const events: Array<Record<string, unknown>> = [];
  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const data = block
              .split('\n')
              .filter((line) => line.startsWith('data: '))
              .map((line) => line.slice(6))
              .join('\n');
            if (data) events.push(JSON.parse(data) as Record<string, unknown>);
          }
        }
      } catch {
        /* aborted */
      }
    })();
  }
  await call(routes, 'POST', '/heartbeat', {
    caller,
    body: {
      tabId,
      url: `http://app.test/${tabId}`,
      title: tabId,
      visibility: 'visible',
      registrationMetadata: { userId: caller, sessionId: `session-${caller}-${tabId}` },
    },
  });
  const seen = new Set<string>();
  return {
    streamId: () => events.find((e) => e.type === 'connected')?.streamId as string | undefined,
    command: async (action) => {
      for (let i = 0; i < 400; i++) {
        const hit = events.find((e) => e.action === action && !seen.has(e.commandId as string));
        if (hit) {
          seen.add(hit.commandId as string);
          return { commandId: hit.commandId as string, payload: hit.payload };
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error(`no ${action} command arrived on the stream`);
    },
    close: () => controller.abort(),
  };
}

let relay: CommandRelay;
let routes: Routes;
let tab: Tab;

beforeEach(async () => {
  // No console capture in the page's realm: the arm under test.
  (globalThis as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__ = {};
  relay = new CommandRelay({
    globalPrefix: `__uiBridgeE2E_${Math.random().toString(36).slice(2, 10)}`,
    sseTimeoutMs: 3000,
    proactiveSnapshot: false,
    pruneSweepIntervalMs: 60_000,
  });
  routes = createNextRouteHandlers(createRelayHandlers(relay), { relay });
  tab = await openTab(routes, 'tab-a', 'user-a');
});

afterEach(() => {
  tab.close();
  relay.destroy();
  (globalThis as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__ = {};
});

describe("the page's real no-capture answer, relayed, comes out as CAPTURE_UNAVAILABLE", () => {
  it.each([
    ['flat', '/control/console-errors'],
    ['grouped', '/control/console-errors?group=true'],
  ])('%s', async (_mode, path) => {
    const pending = call(routes, 'GET', path, { caller: 'user-a' });
    const cmd = await tab.command('getConsoleErrors');

    // The tab runs the real dispatcher …
    const result = (await executeCommand(
      'getConsoleErrors',
      (cmd.payload ?? {}) as Record<string, unknown>,
      emptyBridge
    )) as { success?: boolean; error?: string };
    expect(result.success).toBe(false);

    // … and posts it the way the relay client does.
    const posted = await call(routes, 'POST', '/commands', {
      caller: 'user-a',
      body: {
        commandId: cmd.commandId,
        success: false,
        result,
        tabId: 'tab-a',
        streamId: tab.streamId(),
        error: result.error,
      },
    });
    expect(posted.status).toBe(200);

    const answer = (await (await pending).json()) as {
      success: boolean;
      code?: string;
      data?: { errors?: unknown; groups?: unknown };
    };
    expect(answer.success).toBe(false);
    expect(answer.code).toBe('CAPTURE_UNAVAILABLE');
    expect(answer.data?.errors).toBeUndefined();
    expect(answer.data?.groups).toBeUndefined();
  });
});
