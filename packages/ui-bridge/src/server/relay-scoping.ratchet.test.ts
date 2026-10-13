/**
 * Ratchet: no call scoped to one user reaches another user's tab or data.
 *
 * Every route in `UI_BRIDGE_ROUTES` that the relay handlers serve, plus the
 * relay's own read routes, is called through the Next.js adapter as user-b.
 * The relay is set up so that leaking is easy:
 *   - tab-a belongs to user-a and is the primary tab;
 *   - every relay-wide store already holds user-a's data: the shared snapshot,
 *     semantic and console caches (filled by unscoped reads from tab-a), user-a's
 *     own scoped cache, the server-side render log and the change-event buffer.
 * A scoped call must dispatch only to tab-b and answer nothing that only user-a
 * produced: no `MARKER-tab-a`, and not even the id `tab-a`.
 *
 * Each route is called twice: once with tab-b answering, once with tab-b
 * failing, so every fallback path runs too. Nothing is hand-listed: a new
 * route whose handler reads relay-wide state fails here.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';
import { createNextRouteHandlers } from './nextjs';
import { UI_BRIDGE_ROUTES, type UIBridgeServerHandlers } from './types';

const BASE = '/api/ui-bridge';

/** What a tab answers to any command: a valid snapshot that names its tab everywhere. */
function answerFrom(tab: string) {
  const marker = `MARKER-${tab}`;
  return {
    marker,
    timestamp: Date.now(),
    elements: [
      {
        id: `${marker}-el`,
        type: 'button',
        label: marker,
        state: { visible: true, textContent: marker },
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
  /** When true, tab-b fails every command it receives. */
  tabBFails: { value: boolean };
}

async function rig(): Promise<Rig> {
  const relay = new CommandRelay({
    globalPrefix: `__uiBridgeRatchet_${Math.random().toString(36).slice(2, 10)}`,
    // No warm-up snapshot: it would land in whichever route's window is open.
    proactiveSnapshot: false,
  });
  const seen: Rig['seen'] = [];
  const tabBFails = { value: false };
  for (const [tab, userId] of [
    ['tab-b', 'user-b'],
    ['tab-a', 'user-a'],
  ] as const) {
    relay.subscribeToCommands((command) => {
      seen.push({ tab, action: command.action });
      setTimeout(() => {
        if (tab === 'tab-b' && tabBFails.value) {
          relay.rejectCommand(command.commandId, 'tab-b failed');
        } else {
          relay.resolveCommand(command.commandId, answerFrom(tab), tab);
        }
      }, 0);
    }, tab);
    relay.receiveHeartbeat(tab, {
      url: `http://app.test/${tab}`,
      title: tab,
      visibility: 'visible',
    });
    relay.recordRegistration(tab, { userId, sessionId: `session-${tab}` });
  }
  const handlers = createRelayHandlers(relay);

  // Fill every relay-wide store with user-a's data.
  await handlers.getControlSnapshot({}); // the unscoped cache, from the primary tab-a
  await handlers.getConsoleErrors({});
  await handlers.getSemanticSnapshot({});
  await handlers.getControlSnapshot({}, { callerUserId: 'user-a' }); // user-a's own cache
  await handlers.getConsoleErrors({}, { callerUserId: 'user-a' });
  await handlers.getSemanticSnapshot({}, { callerUserId: 'user-a' });
  const internals = handlers as unknown as Record<string, (arg: unknown) => void>;
  internals.__addRenderLogEntry({
    id: 'MARKER-tab-a-server-log',
    type: 'render',
    timestamp: Date.now(),
    data: 'MARKER-tab-a',
  });
  internals.__pushChangeEvent({
    type: 'subtreeChanged',
    timestamp: Date.now(),
    added: ['MARKER-tab-a'],
    removed: [],
    modified: [],
  });
  return { relay, handlers, seen, tabBFails };
}

interface Case {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
}

/** Every route the relay handlers serve, with its URL params filled in. */
function cases(handlers: UIBridgeServerHandlers): Case[] {
  const fromTable = UI_BRIDGE_ROUTES.filter(
    (route) => typeof (handlers as unknown as Record<string, unknown>)[route.handler] === 'function'
  ).map((route) => ({
    method: route.method,
    path: route.path.replace(/:[A-Za-z]+/g, 'p1') + (route.queryRequired ? '?recency=any' : ''),
  }));
  // The relay's own read routes, answered by the adapter rather than a handler.
  return [
    ...fromTable,
    { method: 'GET', path: '/tabs' },
    { method: 'GET', path: '/health' },
    { method: 'GET', path: '/status' },
  ];
}

async function callAsUserB(handlers: UIBridgeServerHandlers, relay: CommandRelay, c: Case) {
  const routes = createNextRouteHandlers(handlers, { relay });
  const url = `http://app.test${BASE}${c.path}`;
  const nextUrl = new URL(url);
  const init: RequestInit = {
    method: c.method,
    headers: { 'Content-Type': 'application/json', 'X-Caller-User-Id': 'user-b' },
  };
  if (c.method === 'POST' || c.method === 'PUT') init.body = '{}';
  const request = Object.assign(new Request(url, init), { nextUrl });
  const response = await routes[c.method](request, {
    params: { path: nextUrl.pathname.slice(BASE.length + 1) },
  });
  return response.text();
}

describe('ratchet: a scoped call never reaches another user', () => {
  let r: Rig;

  beforeEach(async () => {
    r = await rig();
  });

  afterEach(() => r.relay.destroy());

  it('covers the whole relay route table', () => {
    // A filter that matched nothing would pass every check below vacuously.
    expect(cases(r.handlers).length).toBeGreaterThan(150);
  });

  for (const tabBFails of [false, true]) {
    const mode = tabBFails ? 'the caller tab failing' : 'the caller tab answering';
    it(`with ${mode}, no route dispatches to tab-a or answers with user-a's data`, async () => {
      r.tabBFails.value = tabBFails;
      const problems: string[] = [];
      for (const c of cases(r.handlers)) {
        const before = r.seen.length;
        let body: string;
        try {
          body = await callAsUserB(r.handlers, r.relay, c);
        } catch (err) {
          body = String(err);
        }
        const reachedA = r.seen.slice(before).filter((s) => s.tab === 'tab-a');
        if (reachedA.length > 0) {
          problems.push(
            `${c.method} ${c.path}: dispatched ${reachedA.map((s) => s.action).join(', ')} to tab-a`
          );
        }
        if (body.includes('MARKER-tab-a'))
          problems.push(`${c.method} ${c.path}: answered with user-a's data`);
        else if (body.includes('tab-a')) problems.push(`${c.method} ${c.path}: named tab-a`);
      }
      expect(problems).toEqual([]);
    }, 120_000);
  }
});
