/**
 * The independent review's shared-state probes, kept as asserting tests.
 *
 * The relay is mounted as qontinui-web mounts it,
 * `createNextRouteHandlers(createRelayHandlers(relay), { relay })`. tab-a
 * belongs to user-a and is the primary tab; tab-b belongs to user-b; user-c is
 * authenticated and has no tab. Every tab answers with data stamped with its
 * own id, so an answer that carries `tab-a` to anyone but user-a crossed
 * users. Each probe also checks where its commands went: never to tab-a.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';
import { createNextRouteHandlers } from './nextjs';

const BASE = '/api/ui-bridge';

interface Seen {
  tab: string;
  action: string;
}

function stamped(tab: string) {
  return {
    tab,
    timestamp: Date.now(),
    elements: [
      {
        id: `elem-${tab}`,
        type: 'button',
        label: `Secret ${tab}`,
        state: { visible: true, rect: { width: 10, height: 10 }, textContent: `text-${tab}` },
      },
    ],
    components: [{ id: `comp-${tab}` }],
    workflows: [{ id: `wf-${tab}` }],
    errors: [{ message: `err-${tab}` }],
    count: 1,
    entries: [{ id: `log-${tab}`, type: 'render', timestamp: 1 }],
    route: `/route-of-${tab}`,
    activeTab: tab,
    specs: { [`spec-${tab}`]: 1 },
  };
}

function twoUserRelay(seen: Seen[]): CommandRelay {
  const relay = new CommandRelay({
    globalPrefix: `__uiBridgeShared_${Math.random().toString(36).slice(2, 10)}`,
    // No warm-up snapshot: every command a probe sees is one a request caused.
    proactiveSnapshot: false,
  });
  for (const [tab, userId] of [
    ['tab-b', 'user-b'],
    ['tab-a', 'user-a'],
  ] as const) {
    relay.subscribeToCommands((command) => {
      seen.push({ tab, action: command.action });
      setTimeout(() => relay.resolveCommand(command.commandId, stamped(tab), tab), 0);
    }, tab);
    relay.receiveHeartbeat(tab, { url: 'http://app.test/', title: tab, visibility: 'visible' });
    relay.recordRegistration(tab, { userId, sessionId: `session-${tab}` });
  }
  return relay;
}

describe('shared relay state is never served across users', () => {
  let seen: Seen[];
  let relay: CommandRelay;
  let handlers: ReturnType<typeof createRelayHandlers>;
  let routes: ReturnType<typeof createNextRouteHandlers>;

  beforeEach(() => {
    seen = [];
    relay = twoUserRelay(seen);
    handlers = createRelayHandlers(relay);
    routes = createNextRouteHandlers(handlers, { relay });
  });

  afterEach(() => relay.destroy());

  /** One request as `user`; what it answered, and which tabs its commands reached. */
  async function as(user: string, method: 'GET' | 'POST', path: string, body?: unknown) {
    const before = seen.length;
    const url = `http://app.test${BASE}${path}`;
    const init: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Caller-User-Id': user },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const nextUrl = new URL(url);
    const request = Object.assign(new Request(url, init), { nextUrl });
    const response = await routes[method](request, {
      params: { path: nextUrl.pathname.slice(BASE.length + 1) },
    });
    const text = await response.text();
    return { text, tabs: seen.slice(before).map((s) => s.tab) };
  }

  /** `user` reads `path` and gets nothing of tab-a's, and no command of theirs reaches tab-a. */
  async function expectIsolated(
    user: string,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ) {
    const { text, tabs } = await as(user, method, path, body);
    expect(tabs).not.toContain('tab-a');
    expect(text).not.toContain('tab-a');
    return text;
  }

  it('S1 the element list comes from the caller tab', async () => {
    await expectIsolated('user-b', 'GET', '/control/elements');
  });

  it("S2 a snapshot user-a's read cached is not served to user-b", async () => {
    await as('user-a', 'GET', '/control/snapshot');
    await expectIsolated('user-b', 'GET', '/control/snapshot?recency=any');
  });

  it('S3 the state summary, idle signals included, comes from the caller tab', async () => {
    await expectIsolated('user-b', 'GET', '/control/state-summary');
  });

  it('S4 visibility', async () => {
    await expectIsolated('user-b', 'POST', '/control/visibility', {});
  });

  it('S5 page health', async () => {
    await expectIsolated('user-b', 'POST', '/control/page-health');
  });

  it("S6 another user's component is not found", async () => {
    const { text, tabs } = await as('user-b', 'GET', '/control/component/comp-tab-a');
    expect(tabs).not.toContain('tab-a');
    expect(JSON.parse(text).success).toBe(false);
  });

  it('S7 workflows', async () => {
    await expectIsolated('user-b', 'GET', '/control/workflows');
  });

  it('S8 ranking', async () => {
    await expectIsolated('user-b', 'POST', '/control/elements/rank', { text: 'Secret' });
  });

  it("S9 a caller with no tab never gets another user's cached console errors", async () => {
    await as('user-a', 'GET', '/control/console-errors');
    await expectIsolated('user-c', 'GET', '/control/console-errors');
  });

  it("S10 a caller with no tab never gets another user's cached semantic snapshot", async () => {
    await as('user-a', 'GET', '/ai/snapshot');
    await expectIsolated('user-c', 'GET', '/ai/snapshot');
  });

  it('S11 find for a caller with no tab', async () => {
    await expectIsolated('user-c', 'POST', '/control/find', { text: 'Secret' });
  });

  it("S12 an element read for a caller with no tab never falls back to another user's cache", async () => {
    await as('user-a', 'GET', '/control/snapshot');
    const { text, tabs } = await as('user-c', 'GET', '/control/element/elem-tab-a');
    expect(tabs).not.toContain('tab-a');
    expect(text).not.toContain('Secret tab-a');
    expect(JSON.parse(text).success).toBe(false);
  });

  it("S13 an element-state read for a caller with no tab never falls back to another user's cache", async () => {
    await as('user-a', 'GET', '/control/snapshot');
    const { text, tabs } = await as('user-c', 'GET', '/control/element/elem-tab-a/state');
    expect(tabs).not.toContain('tab-a');
    expect(text).not.toContain('text-tab-a');
    expect(JSON.parse(text).success).toBe(false);
  });

  it('S14 specs come from the caller tab', async () => {
    await expectIsolated('user-b', 'GET', '/control/specs');
  });

  it("S15 a routing error names only the caller's own tabs, however the request names the caller", async () => {
    const text = await expectIsolated(
      'user-b',
      'GET',
      '/control/elements?tabId=nope&__callerUserId=user-a'
    );
    expect(JSON.parse(text).code).toBe('TAB_NOT_FOUND');
  });

  it('S16 the server-side render log is not served to a scoped caller', async () => {
    (handlers as unknown as Record<string, (e: unknown[]) => void>).__addRenderLogEntries([
      { id: 'log-from-tab-a', type: 'render', timestamp: 5 },
    ]);
    await expectIsolated('user-c', 'GET', '/render-log');
  });

  it('S17 the change-event buffer is refused to a scoped caller, with a typed error', async () => {
    (handlers as unknown as Record<string, (e: unknown) => void>).__pushChangeEvent({
      type: 'dom',
      timestamp: Date.now() + 1000,
      detail: 'change-in-tab-a',
    });
    const text = await expectIsolated('user-b', 'GET', '/control/changes/since?since=0');
    expect(JSON.parse(text).success).toBe(false);
  });
});
