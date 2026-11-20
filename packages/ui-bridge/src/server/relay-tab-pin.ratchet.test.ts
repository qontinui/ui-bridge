/**
 * Ratchet: a call pinned to a tab (`?tabId=` or `X-UI-Bridge-Tab-Id`) reaches
 * only that tab and answers only from that tab's data.
 *
 * Measured on the deployed relay (coord finding 3df6267e): of 55
 * `GET /control/state-summary?tabId=<own tab>` reads, 18 sent their inner
 * `getIdleStatus` to the operator's OTHER tabs and the rest of the summary was
 * synthesized from the caller's cache, which is filled from whichever tab was
 * primary. The adapters read the pin, but delivered it only through a body or
 * a query bag, so a handler that takes neither (`getStateSummary(context)`,
 * `getComponents(context)`, `getElementState(id, context)`, …) never saw it.
 *
 * The setup makes leaking easy. One user owns two tabs: tab-agent connects
 * first, tab-op connects second and is therefore the primary tab. Every cache
 * the relay keeps (the caller's own and the unscoped one) is already filled
 * from tab-op. Every route the relay handlers serve is then called pinned to
 * tab-agent, scoped and unscoped, through every adapter. A pinned call must
 * dispatch nothing to tab-op and answer nothing tab-op produced. Nothing is
 * hand-listed: a new route that drops the pin fails here.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';
import { createNextRouteHandlers } from './nextjs';
import { createExpressApp } from './express';
import { createStandaloneServer, type StandaloneServer } from './standalone';
import { UI_BRIDGE_ROUTES, type UIBridgeServerHandlers } from './types';

const BASE = '/api/ui-bridge';
const USER = 'user-x';

/** What a tab answers to any command: a valid snapshot that names its tab everywhere. */
function answerFrom(tab: string) {
  const marker = `MARKER-${tab}`;
  return {
    marker,
    timestamp: Date.now(),
    route: `/${marker}`,
    elements: [
      {
        id: `${marker}-el`,
        type: 'button',
        label: marker,
        state: { visible: true, textContent: marker, rect: { width: 10, height: 10 } },
      },
    ],
    components: [{ id: `${marker}-comp`, name: marker }],
    workflows: [{ id: `${marker}-wf`, name: marker }],
    entries: [{ id: `${marker}-log`, type: 'render', timestamp: Date.now(), data: marker }],
    errors: [{ message: marker }],
    count: 1,
  };
}

interface Rig {
  relay: CommandRelay;
  handlers: UIBridgeServerHandlers;
  /** Every command dispatched, with the tab it reached. */
  seen: Array<{ tab: string; action: string }>;
}

async function rig(): Promise<Rig> {
  const relay = new CommandRelay({
    globalPrefix: `__uiBridgePin_${Math.random().toString(36).slice(2, 10)}`,
    // No warm-up snapshot: every command a test sees is one a request caused.
    proactiveSnapshot: false,
  });
  const seen: Rig['seen'] = [];
  for (const tab of ['tab-agent', 'tab-op'] as const) {
    relay.subscribeToCommands((command) => {
      seen.push({ tab, action: command.action });
      setTimeout(() => relay.resolveCommand(command.commandId, answerFrom(tab), tab), 0);
    }, tab);
    relay.receiveHeartbeat(tab, {
      url: `http://app.test/${tab}`,
      title: tab,
      visibility: 'visible',
    });
    relay.recordRegistration(tab, { userId: USER, sessionId: `session-${tab}` });
  }
  const handlers = createRelayHandlers(relay);

  // Fill every per-caller cache from the primary, tab-op.
  for (const context of [undefined, { callerUserId: USER }]) {
    await handlers.getControlSnapshot({}, context);
    await handlers.getConsoleErrors({}, context);
    await handlers.getSemanticSnapshot({}, context);
  }
  if (!seen.some((s) => s.tab === 'tab-op')) throw new Error('the rig never filled a cache');
  seen.length = 0;
  return { relay, handlers, seen };
}

interface Case {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** The path with its URL params filled, and no query string. */
  path: string;
  queryRequired: boolean;
}

/** The cached tab-op row id a route's URL id should name. */
function idFor(path: string): string {
  if (/component/.test(path)) return 'MARKER-tab-op-comp';
  if (/workflow/.test(path)) return 'MARKER-tab-op-wf';
  return 'MARKER-tab-op-el';
}

/**
 * Whether a response carries tab-op's data. A request's own URL id
 * (`MARKER-tab-op-el`) can be echoed in a not-found message, so the check is
 * for the bare marker, which only a tab-op answer carries (`"MARKER-tab-op"`,
 * `"/MARKER-tab-op"`).
 */
function carriesTabOpData(body: string): boolean {
  return /MARKER-tab-op(?![-\w])/.test(body);
}

/** Every route the relay handlers serve, with its URL params filled in. */
function cases(handlers: UIBridgeServerHandlers): Case[] {
  return UI_BRIDGE_ROUTES.filter(
    (route) => typeof (handlers as unknown as Record<string, unknown>)[route.handler] === 'function'
  ).map((route) => ({
    method: route.method as Case['method'],
    // A URL id names one of tab-op's cached rows, so a handler that answers
    // an id from the caller's cache would find it there and leak it.
    path: route.path.replace(/:[A-Za-z]+/g, idFor(route.path)),
    queryRequired: route.queryRequired === true,
  }));
}

type PinVia = 'query' | 'header';

/** One request through an adapter: method, full path (query included), headers. */
type Send = (
  method: Case['method'],
  pathAndQuery: string,
  headers: Record<string, string>
) => Promise<string>;

function requestHeaders(scoped: boolean, pinVia: PinVia, tab: string | null) {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (scoped) h['X-Caller-User-Id'] = USER;
  if (tab && pinVia === 'header') h['X-UI-Bridge-Tab-Id'] = tab;
  return h;
}

function pathFor(c: Case, pinVia: PinVia, tab: string | null): string {
  const query: string[] = [];
  if (c.queryRequired) query.push('recency=any');
  if (tab && pinVia === 'query') query.push(`tabId=${tab}`);
  return query.length ? `${c.path}?${query.join('&')}` : c.path;
}

function nextSend(handlers: UIBridgeServerHandlers, relay: CommandRelay): Send {
  const routes = createNextRouteHandlers(handlers, { relay });
  return async (method, pathAndQuery, headers) => {
    const url = `http://app.test${BASE}${pathAndQuery}`;
    const nextUrl = new URL(url);
    const init: RequestInit = { method, headers };
    if (method === 'POST' || method === 'PUT') init.body = '{}';
    const request = Object.assign(new Request(url, init), { nextUrl });
    const response = await routes[method](request, {
      params: { path: nextUrl.pathname.slice(BASE.length + 1) },
    });
    return response.text();
  };
}

function fetchSend(port: number): Send {
  return async (method, pathAndQuery, headers) => {
    const init: RequestInit = { method, headers };
    if (method === 'POST' || method === 'PUT') init.body = '{}';
    const response = await fetch(`http://127.0.0.1:${port}${BASE}${pathAndQuery}`, init);
    return response.text();
  };
}

/** Every route, pinned to tab-agent: what reached tab-op, and what answered with tab-op's data. */
async function sweep(r: Rig, send: Send, scoped: boolean, pinVia: PinVia): Promise<string[]> {
  const problems: string[] = [];
  for (const c of cases(r.handlers)) {
    // Make tab-op the most recently successful tab before every case, so an
    // owner-ranked (scoped, unpinned) dispatch would pick it: otherwise a
    // pinned success on tab-agent earlier in the sweep would mask a later leak.
    await r.relay.queueCommand('ping', {}, { targetTabId: 'tab-op' });
    const before = r.seen.length;
    let body: string;
    try {
      body = await send(
        c.method,
        pathFor(c, pinVia, 'tab-agent'),
        requestHeaders(scoped, pinVia, 'tab-agent')
      );
    } catch (err) {
      body = String(err);
    }
    const reachedOp = r.seen.slice(before).filter((s) => s.tab === 'tab-op');
    if (reachedOp.length > 0) {
      problems.push(
        `${c.method} ${c.path}: dispatched ${reachedOp.map((s) => s.action).join(', ')} to tab-op`
      );
    }
    if (carriesTabOpData(body)) problems.push(`${c.method} ${c.path}: answered with tab-op's data`);
  }
  return problems;
}

/**
 * Every route, pinned to a tab that is not connected: nothing may be
 * dispatched to any tab, and nothing either tab produced may come back.
 */
async function sweepUnreachable(r: Rig, send: Send, scoped: boolean): Promise<string[]> {
  const problems: string[] = [];
  for (const c of cases(r.handlers)) {
    const before = r.seen.length;
    let body: string;
    try {
      body = await send(
        c.method,
        pathFor(c, 'query', 'tab-ghost'),
        requestHeaders(scoped, 'query', 'tab-ghost')
      );
    } catch (err) {
      body = String(err);
    }
    const reached = r.seen.slice(before);
    if (reached.length > 0) {
      problems.push(
        `${c.method} ${c.path}: dispatched ${reached.map((s) => `${s.action}@${s.tab}`).join(', ')}`
      );
    }
    if (carriesTabOpData(body) || /MARKER-tab-agent(?![-\w])/.test(body)) {
      problems.push(`${c.method} ${c.path}: answered with a connected tab's data`);
    }
  }
  return problems;
}

const MODES: Array<{ scoped: boolean; pinVia: PinVia }> = [
  { scoped: true, pinVia: 'query' },
  { scoped: false, pinVia: 'query' },
  { scoped: true, pinVia: 'header' },
  { scoped: false, pinVia: 'header' },
];

describe('ratchet: a pinned call reaches only the pinned tab — Next.js adapter', () => {
  let r: Rig;
  beforeEach(async () => {
    r = await rig();
  });
  afterEach(() => r.relay.destroy());

  it('covers the whole relay route table', () => {
    // A filter that matched nothing would pass every check below vacuously.
    expect(cases(r.handlers).length).toBeGreaterThan(150);
  });

  for (const { scoped, pinVia } of MODES) {
    it(`${scoped ? 'scoped' : 'unscoped'}, pinned by ${pinVia}: no route reaches tab-op or answers with its data`, async () => {
      expect(await sweep(r, nextSend(r.handlers, r.relay), scoped, pinVia)).toEqual([]);
    }, 120_000);
  }

  for (const scoped of [true, false]) {
    it(`${scoped ? 'scoped' : 'unscoped'}, pinned to a tab that is not connected: no route reaches any tab or answers with its data`, async () => {
      expect(await sweepUnreachable(r, nextSend(r.handlers, r.relay), scoped)).toEqual([]);
    }, 120_000);
  }
});

describe('ratchet: a pinned call reaches only the pinned tab — Express adapter', () => {
  let r: Rig;
  let server: Server;
  let send: Send;
  beforeEach(async () => {
    r = await rig();
    const app = createExpressApp(r.handlers, { basePath: BASE }) as Parameters<
      typeof createServer
    >[1];
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    send = fetchSend((server.address() as AddressInfo).port);
  });
  afterEach(async () => {
    r.relay.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  for (const { scoped, pinVia } of MODES) {
    it(`${scoped ? 'scoped' : 'unscoped'}, pinned by ${pinVia}: no route reaches tab-op or answers with its data`, async () => {
      expect(await sweep(r, send, scoped, pinVia)).toEqual([]);
    }, 120_000);
  }
});

describe('ratchet: a pinned call reaches only the pinned tab — standalone adapter', () => {
  let r: Rig;
  let server: StandaloneServer;
  let send: Send;
  beforeEach(async () => {
    r = await rig();
    server = await createStandaloneServer(r.handlers, {
      host: '127.0.0.1',
      port: 0,
      basePath: BASE,
      log: () => {},
    });
    send = fetchSend(server.getAddress()!.port);
  });
  afterEach(async () => {
    r.relay.destroy();
    await server.stop();
  });

  for (const { scoped, pinVia } of MODES) {
    it(`${scoped ? 'scoped' : 'unscoped'}, pinned by ${pinVia}: no route reaches tab-op or answers with its data`, async () => {
      expect(await sweep(r, send, scoped, pinVia)).toEqual([]);
    }, 120_000);
  }
});

describe('an unpinned call keeps today’s behaviour', () => {
  let r: Rig;
  beforeEach(async () => {
    r = await rig();
  });
  afterEach(() => r.relay.destroy());

  for (const scoped of [true, false]) {
    it(`${scoped ? 'scoped' : 'unscoped'}: state-summary asks the primary and reads the caller cache`, async () => {
      const body = JSON.parse(
        await nextSend(r.handlers, r.relay)(
          'GET',
          '/control/state-summary',
          requestHeaders(scoped, 'query', null)
        )
      ) as { success: boolean; data: Record<string, unknown> };
      expect(body.success).toBe(true);
      expect(r.seen).toEqual([{ tab: 'tab-op', action: 'getIdleStatus' }]);
      expect(body.data.route).toBe('/MARKER-tab-op');
      expect(body.data.hasErrors).toBe(true);
      expect(body.data.visibleElementCount).toBe(1);
    });
  }
});

describe('a pinned state-summary answers from the pinned tab', () => {
  let r: Rig;
  beforeEach(async () => {
    r = await rig();
  });
  afterEach(() => r.relay.destroy());

  for (const scoped of [true, false]) {
    it(`${scoped ? 'scoped' : 'unscoped'}: every field is the pinned tab's`, async () => {
      const body = JSON.parse(
        await nextSend(r.handlers, r.relay)(
          'GET',
          '/control/state-summary?tabId=tab-agent',
          requestHeaders(scoped, 'query', 'tab-agent')
        )
      ) as { success: boolean; data: Record<string, unknown> };
      expect(body.success).toBe(true);
      expect(r.seen.length).toBeGreaterThan(0);
      expect(r.seen.every((s) => s.tab === 'tab-agent')).toBe(true);
      expect(r.seen.map((s) => s.action)).toContain('getIdleStatus');
      expect(body.data.route).toBe('/MARKER-tab-agent');
      expect(body.data.hasErrors).toBe(true);
      expect(body.data.visibleElementCount).toBe(1);
      expect(body.data.registeredComponents).toBe(1);
    });
  }

  for (const [method, path] of [
    ['GET', '/control/state-summary'],
    ['GET', '/control/workflows'],
    ['GET', '/control/console-errors'],
    ['GET', '/ai/snapshot'],
    ['GET', '/control/component/MARKER-tab-op-comp'],
    ['POST', '/control/elements/rank'],
    ['POST', '/control/page-health'],
    ['POST', '/control/visibility'],
  ] as const) {
    it(`a pinned ${method} ${path} on a tab that is not connected answers the routing error`, async () => {
      const body = JSON.parse(
        await nextSend(r.handlers, r.relay)(
          method,
          `${path}?tabId=tab-ghost`,
          requestHeaders(true, 'query', 'tab-ghost')
        )
      ) as { success: boolean; code?: string };
      expect(body.success).toBe(false);
      expect(body.code).toBe('TAB_NOT_FOUND');
      expect(r.seen).toEqual([]);
    });
  }

  it('a pinned read does not overwrite the caller cache an unpinned read answers from', async () => {
    const send = nextSend(r.handlers, r.relay);
    await send(
      'GET',
      '/control/state-summary?tabId=tab-agent',
      requestHeaders(true, 'query', 'tab-agent')
    );
    r.seen.length = 0;
    const body = JSON.parse(
      await send('GET', '/control/state-summary', requestHeaders(true, 'query', null))
    ) as { data: Record<string, unknown> };
    expect(body.data.route).toBe('/MARKER-tab-op');
  });
});
