/**
 * A scoped caller cannot tell a tab it may not address from a tab that does
 * not exist (per-user tab scoping, §4.2). Another user's tab, a missing tab,
 * and a tab whose stream is open but which no heartbeat has registered yet all
 * answer with the same status and the same bytes, through every adapter, and
 * nothing is delivered to the tabs that are not the caller's. Nor can another
 * user claim a tab that is streaming before its first heartbeat. With no caller
 * identity (single-user mode) a missing tab keeps the diagnostic answer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';
import { createNextRouteHandlers } from './nextjs';
import { createExpressApp } from './express';
import { createStandaloneServer, type StandaloneServer } from './standalone';

const BASE = '/api/ui-bridge';
const CALLER = 'user-a';
const OTHER = 'user-b';
/** Tabs the caller may not address: another user's, a missing one, an unregistered one. */
const UNADDRESSABLE = ['tab-foreign', 'tab-missing', 'tab-unregistered'];

interface Answer {
  status: number;
  text: string;
}
type Fetch = (
  method: 'GET' | 'POST',
  path: string,
  caller?: string,
  body?: unknown
) => Promise<Answer>;

/**
 * A relay holding one tab of the caller's, one registered to another user, and
 * one streaming for another user before its first heartbeat. Every tab answers
 * a command it receives, so a delivery shows up as an answer, not a timeout.
 */
function relayWithTabs() {
  const relay = new CommandRelay({
    globalPrefix: `__scopedTabNotFound_${Math.random().toString(36).slice(2, 10)}`,
    proactiveSnapshot: false,
    sseTimeoutMs: 3000,
  });
  const delivered: string[] = [];
  const stream = (tabId: string, userId: string) => {
    const opened = relay.openCommandStream(
      (command) => {
        delivered.push(`${tabId}:${command.action}`);
        relay.resolveCommand(
          command.commandId,
          { elements: [{ id: `${tabId}-element` }], components: [], workflows: [], timestamp: 1 },
          tabId,
          { callerUserId: userId, streamId: opened.streamId }
        );
      },
      tabId,
      userId
    );
  };
  stream('tab-own', CALLER);
  relay.recordRegistration(
    'tab-own',
    { userId: CALLER, sessionId: 's-a' },
    { callerUserId: CALLER }
  );
  relay.receiveHeartbeat('tab-own');
  stream('tab-foreign', OTHER);
  relay.recordRegistration(
    'tab-foreign',
    { userId: OTHER, sessionId: 's-b' },
    { callerUserId: OTHER }
  );
  relay.receiveHeartbeat('tab-foreign');
  stream('tab-unregistered', OTHER);
  return { relay, delivered };
}

let relay: CommandRelay;
let delivered: string[];
let server: Server | undefined;
let standalone: StandaloneServer | undefined;

beforeEach(() => {
  // One clock for every answer, so two answers can be compared byte for byte.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  ({ relay, delivered } = relayWithTabs());
});

afterEach(async () => {
  vi.useRealTimers();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (standalone) await standalone.stop();
  server = undefined;
  standalone = undefined;
  relay.destroy();
});

function nextFetch(): Fetch {
  const routes = createNextRouteHandlers(createRelayHandlers(relay), { relay });
  return async (method, path, caller, body) => {
    const url = `http://app.test${BASE}${path}`;
    const nextUrl = new URL(url);
    const headers: Record<string, string> = caller ? { 'X-Caller-User-Id': caller } : {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const request = Object.assign(
      new Request(url, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      { nextUrl }
    );
    const context = { params: { path: nextUrl.pathname.slice(BASE.length + 1).split('/') } };
    const response = await (method === 'GET' ? routes.GET : routes.POST)(request, context);
    return { status: response.status, text: await response.text() };
  };
}

function httpFetch(port: number): Fetch {
  return async (method, path, caller, body) => {
    const headers: Record<string, string> = caller ? { 'X-Caller-User-Id': caller } : {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`http://127.0.0.1:${port}${BASE}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, text: await response.text() };
  };
}

async function expressFetch(): Promise<Fetch> {
  const app = createExpressApp(createRelayHandlers(relay), { basePath: BASE }) as Parameters<
    typeof createServer
  >[1];
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return httpFetch((server.address() as AddressInfo).port);
}

async function standaloneFetch(): Promise<Fetch> {
  standalone = await createStandaloneServer(createRelayHandlers(relay), {
    host: '127.0.0.1',
    port: 0,
    basePath: BASE,
    log: () => {},
  });
  return httpFetch(standalone.getAddress()!.port);
}

const ADAPTERS: Array<[string, () => Fetch | Promise<Fetch>]> = [
  ['Next.js', nextFetch],
  ['Express', expressFetch],
  ['standalone', standaloneFetch],
];

/** The pinned reads and actions every adapter serves. */
const PINNED: Array<
  [string, 'GET' | 'POST', (tabId: string) => string, (tabId: string) => unknown]
> = [
  ['a pinned read', 'GET', (tabId) => `/control/elements?tabId=${tabId}`, () => undefined],
  [
    'a pinned action',
    'POST',
    () => '/control/element/el-1/action',
    (tabId) => ({ action: 'click', tabId }),
  ],
];

describe.each(ADAPTERS)('the %s adapter', (_name, makeFetch) => {
  for (const [what, method, pathFor, bodyFor] of PINNED) {
    it(`answers ${what} of a tab the caller may not address with one status and one body`, async () => {
      const call = await makeFetch();
      const answers: Answer[] = [];
      for (const tabId of UNADDRESSABLE) {
        answers.push(await call(method, pathFor(tabId), CALLER, bodyFor(tabId)));
      }
      expect(answers[0].status).toBe(404);
      for (const answer of answers) {
        expect(answer).toEqual(answers[0]);
        for (const tabId of [...UNADDRESSABLE, 'tab-own']) expect(answer.text).not.toContain(tabId);
        expect(answer.text).not.toContain('currently: [');
      }
      expect(delivered.filter((entry) => !entry.startsWith('tab-own:'))).toEqual([]);
    });
  }

  it('keeps the diagnostic answer for a missing tab when the caller is unscoped', async () => {
    const call = await makeFetch();
    const answer = await call('GET', '/control/elements?tabId=tab-missing');
    expect(answer.status).toBe(404);
    expect(answer.text).toContain('tab-missing');
    expect(answer.text).toContain('currently: [');
  });
});

describe('the Next.js tab commands', () => {
  for (const command of ['activate', 'close']) {
    it(`/tabs/:tabId/${command} answers every tab the caller may not address alike`, async () => {
      const call = nextFetch();
      const answers: Answer[] = [];
      for (const tabId of UNADDRESSABLE) {
        answers.push(await call('POST', `/tabs/${tabId}/${command}`, CALLER));
      }
      expect(answers[0].status).toBe(404);
      for (const answer of answers) {
        expect(answer).toEqual(answers[0]);
        for (const tabId of UNADDRESSABLE) expect(answer.text).not.toContain(tabId);
      }
      expect(delivered.filter((entry) => !entry.startsWith('tab-own:'))).toEqual([]);
    });
  }

  it('keeps the diagnostic answer for a missing tab when the caller is unscoped', async () => {
    const answer = await nextFetch()('POST', '/tabs/tab-missing/activate');
    expect(answer.status).toBe(404);
    expect(answer.text).toContain('tab-missing');
  });
});

describe('a tab streaming before its first heartbeat', () => {
  it('cannot be claimed by another user, so it stays unaddressable to them', async () => {
    const call = nextFetch();
    const claim = await call('POST', '/heartbeat', CALLER, {
      tabId: 'tab-unregistered',
      registrationMetadata: { userId: CALLER, sessionId: 's-a2' },
    });
    expect(claim.status).toBe(200);
    expect(JSON.parse(claim.text).data).toMatchObject({ ownershipAssigned: false });
    expect(relay.getOwnership('tab-unregistered')).toBeNull();

    const missing = await call('GET', '/control/elements?tabId=tab-missing', CALLER);
    const unregistered = await call('GET', '/control/elements?tabId=tab-unregistered', CALLER);
    expect(unregistered.status).toBe(404);
    expect(unregistered).toEqual(missing);
    expect(delivered.filter((entry) => !entry.startsWith('tab-own:'))).toEqual([]);

    // The user streaming to it registers it as before.
    const own = await call('POST', '/heartbeat', OTHER, {
      tabId: 'tab-unregistered',
      registrationMetadata: { userId: OTHER, sessionId: 's-b2' },
    });
    expect(JSON.parse(own.text).data.ownershipAssigned).toBeUndefined();
    expect(relay.getOwnership('tab-unregistered')?.userId).toBe(OTHER);
  });
});
