/**
 * The independent review's request probes, kept as asserting tests.
 *
 * Each probe sends one request as user-b, through each adapter, to a relay on
 * which tab-a belongs to user-a and is the primary tab, and tab-b belongs to
 * user-b. Whatever the probe tries (a reserved key in the query or the body,
 * in any spelling or at any depth, a pinned tab it does not own, an odd
 * body), no command may reach tab-a and no command may carry the reserved
 * key. The one exception is the last body probe, which sends no identity:
 * that is the unscoped (admin) mode, where the primary tab is the right
 * target, and only the strip is checked.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';
import { createNextRouteHandlers } from './nextjs';
import { createExpressApp } from './express';
import { createStandaloneServer, type StandaloneServer } from './standalone';

const BASE = '/api/ui-bridge';

interface Seen {
  tab: string;
  action: string;
  payload: unknown;
}

function twoUserRelay(seen: Seen[]): CommandRelay {
  const relay = new CommandRelay({
    globalPrefix: `__uiBridgeProbe_${Math.random().toString(36).slice(2, 10)}`,
    // No warm-up snapshot: every command a probe sees is one a request caused.
    proactiveSnapshot: false,
  });
  for (const [tab, userId] of [
    ['tab-b', 'user-b'],
    ['tab-a', 'user-a'],
  ] as const) {
    relay.subscribeToCommands((command) => {
      seen.push({ tab, action: command.action, payload: command.payload });
      setTimeout(
        () =>
          relay.resolveCommand(
            command.commandId,
            {
              tab,
              elements: [],
              components: [],
              workflows: [],
              timestamp: Date.now(),
              errors: [],
              count: 0,
            },
            tab
          ),
        0
      );
    }, tab);
    relay.receiveHeartbeat(tab, { url: 'http://app.test/', title: tab, visibility: 'visible' });
    relay.recordRegistration(tab, { userId, sessionId: `session-${tab}` });
  }
  return relay;
}

type Opts = { body?: string; caller?: string | null; contentType?: string };
type Reply = { status: number; json: Record<string, unknown> | string };
type Call = (method: string, path: string, o?: Opts) => Promise<Reply>;

function headers(o: Opts): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': o.contentType ?? 'application/json' };
  if (o.caller !== null) h['X-Caller-User-Id'] = o.caller ?? 'user-b';
  return h;
}

const parse = (text: string): Reply['json'] => {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return text;
  }
};

function nextCall(relay: CommandRelay): Call {
  const routes = createNextRouteHandlers(createRelayHandlers(relay), {
    relay,
  }) as unknown as Record<
    string,
    (request: Request, context: { params: { path: string } }) => Promise<Response>
  >;
  return async (method, path, o = {}) => {
    const url = `http://app.test${BASE}${path}`;
    const init: RequestInit = { method, headers: headers(o) };
    if (o.body !== undefined) init.body = o.body;
    const nextUrl = new URL(url);
    const request = Object.assign(new Request(url, init), { nextUrl });
    const response = await routes[method](request, {
      params: { path: nextUrl.pathname.slice(BASE.length + 1) },
    });
    return { status: response.status, json: parse(await response.text()) };
  };
}

function httpCall(port: number): Call {
  return async (method, path, o = {}) => {
    if (method === 'GET' && o.body !== undefined) {
      // fetch() cannot send a GET body; node:http can.
      return new Promise((resolve, reject) => {
        const req = httpRequest(
          {
            host: '127.0.0.1',
            port,
            path: `${BASE}${path}`,
            method: 'GET',
            headers: { ...headers(o), 'Content-Length': Buffer.byteLength(o.body!) },
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, json: parse(data) }));
          }
        );
        req.on('error', reject);
        req.write(o.body);
        req.end();
      });
    }
    const init: RequestInit = { method, headers: headers(o) };
    if (o.body !== undefined) init.body = o.body;
    const response = await fetch(`http://127.0.0.1:${port}${BASE}${path}`, init);
    return { status: response.status, json: parse(await response.text()) };
  };
}

const QUERY_PROBES: Array<[string, string]> = [
  ['Q1 console-errors', '/control/console-errors?__callerUserId=user-a'],
  ['Q2 snapshot', '/control/snapshot?__callerUserId=user-a'],
  ['Q3 browser-events', '/control/browser-events?__callerUserId=user-a'],
  ['Q4 network-requests', '/control/network-requests?__callerUserId=user-a'],
  ['Q5 render-log', '/control/render-log?__callerUserId=user-a'],
  ['Q6 ai-snapshot', '/ai/snapshot?__callerUserId=user-a'],
  ['Q7 elements pinned', '/control/elements?tabId=tab-a&__callerUserId=user-a'],
  ['Q8 element pinned', '/control/element/x?tabId=tab-a&__callerUserId=user-a'],
  ['Q9 components pinned', '/control/components?tabId=tab-a&__callerUserId=user-a'],
  ['Q10 timeline', '/control/timeline?__callerUserId=user-a'],
  ['Q11 health', '/control/health?__callerUserId=user-a'],
  ['Q12 network-chains', '/control/network-chains?__callerUserId=user-a'],
  ['Q13 error-snapshots', '/control/error-snapshots?__callerUserId=user-a'],
  ['Q14 repeated key', '/control/console-errors?__callerUserId=zzz&__callerUserId=user-a'],
  ['Q15 percent-encoded key', '/control/console-errors?%5F%5FcallerUserId=user-a'],
  ['Q16 case variant', '/control/console-errors?__CALLERUSERID=user-a'],
  ['Q17 no-underscore key', '/control/console-errors?callerUserId=user-a'],
  ['Q18 control (no spoof)', '/control/console-errors'],
  ['Q19 tab pin without identity', '/control/console-errors?tabId=tab-a'],
  ['Q20 id-only route + query', '/control/element/save/state?__callerUserId=user-a'],
];

const BODY_PROBES: Array<[string, string, string, Opts]> = [
  [
    'B1 top-level body id',
    'POST',
    '/control/find',
    { body: JSON.stringify({ text: 'x', __callerUserId: 'user-a' }) },
  ],
  [
    'B2 nested request id',
    'POST',
    '/control/find',
    { body: JSON.stringify({ text: 'x', request: { __callerUserId: 'user-a' } }) },
  ],
  [
    'B3 named intent body id',
    'POST',
    '/control/intent/demo/execute',
    { body: JSON.stringify({ __callerUserId: 'user-a', params: { n: 1 } }) },
  ],
  [
    'B4 component params carry the key',
    'POST',
    '/control/component/save/action/click',
    { body: JSON.stringify({ params: { __callerUserId: 'user-a' } }) },
  ],
  [
    'B5 component flat key',
    'POST',
    '/control/component/save/action/click',
    { body: JSON.stringify({ __callerUserId: 'user-a', layoutId: 'single' }) },
  ],
  [
    'B6 array body',
    'POST',
    '/control/find',
    { body: JSON.stringify([{ __callerUserId: 'user-a' }]) },
  ],
  [
    'B7 text/plain body',
    'POST',
    '/control/find',
    { body: JSON.stringify({ __callerUserId: 'user-a' }), contentType: 'text/plain' },
  ],
  [
    'B8 POST with query id',
    'POST',
    '/control/find?__callerUserId=user-a',
    { body: JSON.stringify({ text: 'x' }) },
  ],
  [
    'B9 __proto__ body',
    'POST',
    '/control/find',
    { body: '{"__proto__":{"__callerUserId":"user-a"},"text":"x"}' },
  ],
  [
    'B10 constructor body',
    'POST',
    '/control/find',
    { body: '{"constructor":{"prototype":{"__callerUserId":"user-a"}},"text":"x"}' },
  ],
  ['B11 invalid JSON', 'POST', '/control/find', { body: '{not json' }],
  ['B12 empty body', 'POST', '/control/find', {}],
  [
    'B13 body pins tab-a',
    'POST',
    '/control/find',
    { body: JSON.stringify({ text: 'x', tabId: 'tab-a' }) },
  ],
  [
    'B14 element action params id',
    'POST',
    '/control/element/save/action',
    { body: JSON.stringify({ action: 'click', params: { __callerUserId: 'user-a' } }) },
  ],
  [
    'B15 batch array body',
    'POST',
    '/control/actions/batch',
    { body: JSON.stringify([{ __callerUserId: 'user-a' }]) },
  ],
  ['B16 string body', 'POST', '/control/find', { body: JSON.stringify('user-a') }],
  ['B17 null body', 'POST', '/control/find', { body: 'null' }],
];

/** Every exact `__callerUserId` key in `value`, at any depth. */
function reservedKeys(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0;
  return Object.entries(value).reduce(
    (n, [key, item]) => n + (key === '__callerUserId' ? 1 : 0) + reservedKeys(item),
    0
  );
}

function suite(
  adapter: string,
  connect: (relay: CommandRelay, closers: Array<() => Promise<void>>) => Promise<Call>
) {
  describe(`review probes over ${adapter}`, () => {
    let seen: Seen[];
    let relay: CommandRelay;
    let call: Call;
    const closers: Array<() => Promise<void>> = [];

    beforeEach(async () => {
      seen = [];
      relay = twoUserRelay(seen);
      call = await connect(relay, closers);
    });

    afterEach(async () => {
      relay.destroy();
      await Promise.all(closers.splice(0).map((close) => close()));
    });

    async function probe(method: string, path: string, o: Opts = {}) {
      const before = seen.length;
      const reply = await call(method, path, o);
      return { reply, fresh: seen.slice(before) };
    }

    for (const [label, path] of QUERY_PROBES) {
      it(`${label}: reaches no other user's tab`, async () => {
        const { reply, fresh } = await probe('GET', path);
        expect(fresh.filter((s) => s.tab === 'tab-a')).toEqual([]);
        expect(fresh.reduce((n, s) => n + reservedKeys(s.payload), 0)).toBe(0);
        expect(JSON.stringify(reply.json)).not.toContain('tab-a"');
      });
    }

    for (const [label, method, path, o] of BODY_PROBES) {
      it(`${label}: reaches no other user's tab`, async () => {
        const { fresh } = await probe(method, path, o);
        expect(fresh.filter((s) => s.tab === 'tab-a')).toEqual([]);
        expect(fresh.reduce((n, s) => n + reservedKeys(s.payload), 0)).toBe(0);
      });
    }

    it('B18 with no identity (admin mode) the body key is still stripped', async () => {
      const { fresh } = await probe('POST', '/control/find', {
        body: JSON.stringify({ __callerUserId: 'user-a' }),
        caller: null,
      });
      expect(fresh.length).toBeGreaterThan(0);
      expect(fresh.reduce((n, s) => n + reservedKeys(s.payload), 0)).toBe(0);
    });

    if (adapter !== 'Next.js') {
      // A fetch Request cannot carry a GET body, so this probe is HTTP-only.
      it('G1 a GET body is ignored', async () => {
        const { fresh } = await probe('GET', '/control/console-errors', {
          body: JSON.stringify({ __callerUserId: 'user-a' }),
        });
        expect(fresh.filter((s) => s.tab === 'tab-a')).toEqual([]);
      });
    }
  });
}

suite('Next.js', async (relay) => nextCall(relay));

suite('Express', async (relay, closers) => {
  const app = createExpressApp(createRelayHandlers(relay), { basePath: BASE }) as Parameters<
    typeof createServer
  >[1];
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return httpCall((server.address() as AddressInfo).port);
});

suite('standalone', async (relay, closers) => {
  const server: StandaloneServer = await createStandaloneServer(createRelayHandlers(relay), {
    host: '127.0.0.1',
    port: 0,
    basePath: BASE,
    log: () => {},
  });
  closers.push(() => server.stop());
  return httpCall(server.getAddress()!.port);
});
