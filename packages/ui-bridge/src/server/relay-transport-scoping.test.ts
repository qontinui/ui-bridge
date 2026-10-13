/**
 * The relay's transport routes are held to the verified caller (per-user tab
 * scoping, §4.2).
 *
 * The routes a browser tab uses to take part in the relay (its command stream,
 * its command results, its heartbeat) and the tab-control routes act for the
 * identity the consumer's auth gate verified (`X-Caller-User-Id`):
 *   - a command stream opens only for a tab that is not another user's;
 *   - a command result settles a command only when it comes from the tab the
 *     command went to, presents that stream's id, and is posted by the tab's
 *     owner;
 *   - closing or activating a tab requires owning it;
 *   - a tab cannot be taken over while its owner's session is live.
 * With no identity (single-user mode) each route behaves as before.
 *
 * Everything goes through the adapters exactly as a multi-user consumer mounts
 * them: `createNextRouteHandlers(createRelayHandlers(relay), { relay })`. tab-b
 * (user-b) connects first; tab-a (user-a) connects second and is primary.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';
import { createNextRouteHandlers } from './nextjs';
import type { RelayBus, RelayCommandEnvelope, RelayResponseEnvelope } from './relay-bus';

const BASE = '/api/ui-bridge';

type Routes = ReturnType<typeof createNextRouteHandlers>;

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
    params: { path: nextUrl.pathname.slice(BASE.length + 1) },
  });
}

/** An open command stream, as a browser tab holds one. */
interface Stream {
  response: Response;
  /** Every SSE data payload received so far, parsed. */
  events: Array<Record<string, unknown>>;
  streamId: () => string | undefined;
  /** The next command with `action`, once it arrives. */
  command: (action: string) => Promise<{ commandId: string; payload: unknown }>;
  close: () => void;
}

async function openStream(routes: Routes, tabId: string, caller?: string): Promise<Stream> {
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
  const seen = new Set<string>();
  return {
    response,
    events,
    streamId: () => events.find((e) => e.type === 'connected')?.streamId as string | undefined,
    command: async (action) => {
      for (let i = 0; i < 200; i++) {
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

function heartbeat(routes: Routes, tabId: string, userId: string, caller?: string, title = tabId) {
  return call(routes, 'POST', '/heartbeat', {
    caller,
    body: {
      tabId,
      url: `http://app.test/${tabId}`,
      title,
      visibility: 'visible',
      registrationMetadata: { userId, sessionId: `session-${userId}-${tabId}` },
    },
  });
}

interface Rig {
  relay: CommandRelay;
  routes: Routes;
  tabA: Stream;
  tabB: Stream;
}

async function rig(options: { tabActiveWindowMs?: number } = {}): Promise<Rig> {
  const relay = new CommandRelay({
    globalPrefix: `__uiBridgeTransport_${Math.random().toString(36).slice(2, 10)}`,
    sseTimeoutMs: 1500,
    proactiveSnapshot: false,
    pruneSweepIntervalMs: 60_000,
    ...options,
  });
  const routes = createNextRouteHandlers(createRelayHandlers(relay), { relay });
  const tabB = await openStream(routes, 'tab-b', 'user-b');
  await heartbeat(routes, 'tab-b', 'user-b', 'user-b');
  const tabA = await openStream(routes, 'tab-a', 'user-a');
  await heartbeat(routes, 'tab-a', 'user-a', 'user-a');
  return { relay, routes, tabA, tabB };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('the command stream opens only for a tab the caller may hold', () => {
  let r: Rig;
  beforeEach(async () => {
    r = await rig();
  });
  afterEach(() => {
    r.tabA.close();
    r.tabB.close();
    r.relay.destroy();
  });

  it("a stream under another user's tab is refused as a tab that does not exist", async () => {
    const res = await call(r.routes, 'GET', '/commands/stream?tabId=tab-a', { caller: 'user-b' });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.code).toBe('TAB_NOT_FOUND');
    expect(JSON.stringify(body)).not.toContain('tab-a');
  });

  it('a verified caller must name the tab it streams for', async () => {
    const res = await call(r.routes, 'GET', '/commands/stream', { caller: 'user-b' });
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('TAB_ID_REQUIRED');
  });

  it("the caller's own tab streams, and its connected event names the stream", async () => {
    const reopened = await openStream(r.routes, 'tab-b', 'user-b');
    expect(reopened.response.status).toBe(200);
    for (let i = 0; i < 50 && !reopened.streamId(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(reopened.streamId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(reopened.streamId()).not.toBe(r.tabB.streamId());
    reopened.close();
  });

  it("a stream bound to another user's identity is not replaced before the tab registers", async () => {
    const unregistered = await openStream(r.routes, 'tab-new', 'user-a');
    const res = await call(r.routes, 'GET', '/commands/stream?tabId=tab-new', { caller: 'user-b' });
    expect(res.status).toBe(404);
    unregistered.close();
  });

  it('with no identity, any stream opens as before', async () => {
    const admin = await openStream(r.routes, 'tab-x');
    expect(admin.response.status).toBe(200);
    admin.close();
  });
});

describe('a command result is taken only from where the command went', () => {
  let r: Rig;
  beforeEach(async () => {
    r = await rig();
  });
  afterEach(() => {
    r.tabA.close();
    r.tabB.close();
    r.relay.destroy();
  });

  // Reviewer probe S21.
  it("another user's stream cannot be hijacked, and a forged result does not settle the command", async () => {
    // The hijack: a stream under tab-a for user-b is refused, so tab-a's own
    // stream stays the one commands go down.
    const hijack = await call(r.routes, 'GET', '/commands/stream?tabId=tab-a', {
      caller: 'user-b',
    });
    expect(hijack.status).toBe(404);

    const victim = call(r.routes, 'POST', '/control/find', {
      caller: 'user-a',
      body: { text: 'typed-by-user-a' },
    });
    const delivered = await r.tabA.command('find');
    expect(r.tabB.events.some((e) => e.action === 'find')).toBe(false);

    // A result posted by user-b, even naming tab-a and holding the command id.
    const forged = await call(r.routes, 'POST', '/commands', {
      caller: 'user-b',
      body: {
        commandId: delivered.commandId,
        success: true,
        result: { elements: [], total: 0, forgedBy: 'user-b' },
        tabId: 'tab-a',
      },
    });
    expect(forged.status).toBe(403);
    expect((await json(forged)).code).toBe('COMMAND_RESPONSE_REFUSED');

    // The genuine result from tab-a's own stream settles it.
    const genuine = await call(r.routes, 'POST', '/commands', {
      caller: 'user-a',
      body: {
        commandId: delivered.commandId,
        success: true,
        result: { elements: [], total: 0, answeredBy: 'tab-a' },
        tabId: 'tab-a',
        streamId: r.tabA.streamId(),
      },
    });
    expect(genuine.status).toBe(200);
    const answer = await json(await victim);
    expect(JSON.stringify(answer)).toContain('answeredBy');
    expect(JSON.stringify(answer)).not.toContain('forgedBy');
  });

  it('a result presenting another stream id is refused, even from the owner', async () => {
    const pending = call(r.routes, 'POST', '/control/find', {
      caller: 'user-a',
      body: { text: 'x' },
    });
    const delivered = await r.tabA.command('find');
    const wrongStream = await call(r.routes, 'POST', '/commands', {
      caller: 'user-a',
      body: {
        commandId: delivered.commandId,
        success: true,
        result: { elements: [] },
        tabId: 'tab-a',
        streamId: '00000000-0000-4000-8000-000000000000',
      },
    });
    expect(wrongStream.status).toBe(403);
    // The owner's result with no stream id (a client that predates them) settles it.
    const noStream = await call(r.routes, 'POST', '/commands', {
      caller: 'user-a',
      body: {
        commandId: delivered.commandId,
        success: true,
        result: { elements: [] },
        tabId: 'tab-a',
      },
    });
    expect(noStream.status).toBe(200);
    expect((await json(await pending)).success).toBe(true);
  });

  it('a result naming another tab than the one the command went to is refused', async () => {
    const pending = call(r.routes, 'POST', '/control/find', {
      caller: 'user-a',
      body: { text: 'x' },
    });
    const delivered = await r.tabA.command('find');
    const otherTab = await call(r.routes, 'POST', '/commands', {
      caller: 'user-a',
      body: { commandId: delivered.commandId, success: true, result: {}, tabId: 'tab-b' },
    });
    expect(otherTab.status).toBe(403);
    await call(r.routes, 'POST', '/commands', {
      caller: 'user-a',
      body: {
        commandId: delivered.commandId,
        success: true,
        result: { elements: [] },
        tabId: 'tab-a',
        streamId: r.tabA.streamId(),
      },
    });
    await pending;
  });

  it('with no identity, a result with no stream id settles the command as before', async () => {
    const pending = call(r.routes, 'POST', '/control/find', { body: { text: 'x' } });
    const delivered = await r.tabA.command('find');
    const res = await call(r.routes, 'POST', '/commands', {
      body: {
        commandId: delivered.commandId,
        success: true,
        result: { elements: [] },
        tabId: 'tab-a',
      },
    });
    expect(res.status).toBe(200);
    expect((await json(await pending)).success).toBe(true);
  });
});

describe('closing or activating a tab requires owning it', () => {
  let r: Rig;
  beforeEach(async () => {
    r = await rig();
  });
  afterEach(() => {
    r.tabA.close();
    r.tabB.close();
    r.relay.destroy();
  });

  for (const verb of ['close', 'activate'] as const) {
    // Reviewer probe S19.
    it(`${verb} on another user's tab answers TAB_NOT_FOUND and reaches no tab`, async () => {
      const res = await call(r.routes, 'POST', `/tabs/tab-a/${verb}`, { caller: 'user-b' });
      expect(res.status).toBe(404);
      const body = await json(res);
      expect(body.code).toBe('TAB_NOT_FOUND');
      expect(JSON.stringify(body)).not.toContain('tab-a');
      await new Promise((resolve) => setTimeout(resolve, 20));
      const action = verb === 'close' ? 'tabClose' : 'tabActivate';
      expect(r.tabA.events.some((e) => e.action === action)).toBe(false);
    });

    it(`${verb} on the caller's own tab reaches it`, async () => {
      const action = verb === 'close' ? 'tabClose' : 'tabActivate';
      void call(r.routes, 'POST', `/tabs/tab-b/${verb}`, { caller: 'user-b' });
      const delivered = await r.tabB.command(action);
      expect(delivered.commandId).toMatch(/^cmd_/);
    });
  }

  it('with no identity, close reaches the named tab as before', async () => {
    void call(r.routes, 'POST', '/tabs/tab-a/close');
    const delivered = await r.tabA.command('tabClose');
    expect(delivered.commandId).toMatch(/^cmd_/);
  });
});

describe("a tab cannot be taken over while its owner's session is live", () => {
  // Reviewer probe S20.
  it("a verified heartbeat claiming another user's live tab is refused and changes nothing", async () => {
    const r = await rig();
    const res = await heartbeat(r.routes, 'tab-a', 'user-b', 'user-b', 'title-from-user-b');
    const body = (await json(res)) as {
      data: { ownershipAssigned?: boolean; ownerChangeRejected?: string };
    };
    expect(body.data.ownershipAssigned).toBe(false);
    expect(body.data.ownerChangeRejected).toBe('OWNER_SESSION_LIVE');
    expect(r.relay.getOwnership('tab-a')?.userId).toBe('user-a');
    // Nothing the refused heartbeat carried reached the tab's record.
    const tabs = (await json(await call(r.routes, 'GET', '/tabs', { caller: 'user-a' }))) as {
      data: { tabs: Array<{ tabId: string; title?: string }> };
    };
    expect(tabs.data.tabs.find((t) => t.tabId === 'tab-a')?.title).toBe('tab-a');
    // And user-b still cannot drive tab-a.
    const drive = await call(r.routes, 'POST', '/control/find', {
      caller: 'user-b',
      body: { text: 'x', tabId: 'tab-a' },
    });
    expect(drive.status).toBe(404);
    r.tabA.close();
    r.tabB.close();
    r.relay.destroy();
  });

  it('a re-login in the same tab takes over once the previous owner has gone quiet', async () => {
    const r = await rig({ tabActiveWindowMs: 60 });
    const early = await heartbeat(r.routes, 'tab-a', 'user-c', 'user-c');
    expect(
      ((await json(early)) as { data: { ownershipAssigned?: boolean } }).data.ownershipAssigned
    ).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 90));
    const late = await heartbeat(r.routes, 'tab-a', 'user-c', 'user-c');
    expect(
      ((await json(late)) as { data: { ownershipAssigned?: boolean } }).data.ownershipAssigned
    ).toBeUndefined();
    expect(r.relay.getOwnership('tab-a')?.userId).toBe('user-c');
    r.tabA.close();
    r.tabB.close();
    r.relay.destroy();
  });

  it('with no identity, a transfer is refused as before', async () => {
    const r = await rig();
    const res = await heartbeat(r.routes, 'tab-a', 'user-b');
    const body = (await json(res)) as {
      data: { ownershipAssigned?: boolean; ownerChangeRejected?: string };
    };
    expect(body.data.ownershipAssigned).toBe(false);
    expect(body.data.ownerChangeRejected).toBe('OWNER_CHANGE_UNVERIFIED');
    expect(r.relay.getOwnership('tab-a')?.userId).toBe('user-a');
    r.tabA.close();
    r.tabB.close();
    r.relay.destroy();
  });
});

/** Synchronous in-memory bus implementing the full RelayBus contract. */
class InMemoryBus implements RelayBus {
  private cmdByTab = new Map<string, Set<(e: RelayCommandEnvelope) => void>>();
  private broadcast = new Set<(e: RelayCommandEnvelope) => void>();
  private respByCmd = new Map<string, Set<(e: RelayResponseEnvelope) => void>>();
  private present = new Set<string>();

  publishCommand(env: RelayCommandEnvelope): void {
    if (env.targetTabId) this.cmdByTab.get(env.targetTabId)?.forEach((h) => h(env));
    else this.broadcast.forEach((h) => h(env));
  }
  subscribeCommands(tabId: string, handler: (e: RelayCommandEnvelope) => void): () => void {
    let set = this.cmdByTab.get(tabId);
    if (!set) this.cmdByTab.set(tabId, (set = new Set()));
    set.add(handler);
    this.broadcast.add(handler);
    return () => {
      set!.delete(handler);
      this.broadcast.delete(handler);
    };
  }
  publishResponse(env: RelayResponseEnvelope): void {
    // Through JSON, as the Redis bus carries it.
    const wire = JSON.parse(JSON.stringify(env)) as RelayResponseEnvelope;
    this.respByCmd.get(env.commandId)?.forEach((h) => h(wire));
  }
  subscribeResponse(commandId: string, handler: (e: RelayResponseEnvelope) => void): () => void {
    let set = this.respByCmd.get(commandId);
    if (!set) this.respByCmd.set(commandId, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  }
  registerTab(tabId: string): void {
    this.present.add(tabId);
  }
  unregisterTab(tabId: string): void {
    this.present.delete(tabId);
  }
  async isTabKnown(tabId: string): Promise<boolean> {
    return this.present.has(tabId);
  }
  async close(): Promise<void> {
    this.cmdByTab.clear();
    this.broadcast.clear();
    this.respByCmd.clear();
    this.present.clear();
  }
}

describe('across instances, a result is held to where the command went', () => {
  it('a forged result is refused where the command was delivered and where it is pending', async () => {
    const bus = new InMemoryBus();
    const prefix = Math.random().toString(36).slice(2, 8);
    const relay = (name: string) =>
      new CommandRelay({
        globalPrefix: `__uiBridgeX${name}_${prefix}`,
        bus,
        sseTimeoutMs: 1500,
        pruneSweepIntervalMs: 60_000,
        proactiveSnapshot: false,
      });
    // A dispatches, B holds tab-a's stream, C is any other instance.
    const [a, b, c] = [relay('A'), relay('B'), relay('C')];
    for (const instance of [a, b]) {
      instance.recordRegistration(
        'tab-a',
        { userId: 'user-a', sessionId: 's-a' },
        { callerUserId: 'user-a' }
      );
    }
    const delivered: Array<{ commandId: string }> = [];
    const stream = b.openCommandStream((command) => delivered.push(command), 'tab-a', 'user-a');

    const answer = a.queueCommand<Record<string, unknown>>(
      'find',
      {},
      { targetTabId: 'tab-a', ownerCheck: { userId: 'user-a' } }
    );
    for (let i = 0; i < 100 && delivered.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const commandId = delivered[0]!.commandId;
    const forged = { forgedBy: 'user-b' };

    // Posted where the command was delivered: refused there, never forwarded.
    expect(b.commandResponseRefusal(commandId, 'tab-a', { callerUserId: 'user-b' })).toBe(
      'NOT_OWNER'
    );
    expect(b.resolveCommand(commandId, forged, 'tab-a', { callerUserId: 'user-b' })).toBe(false);
    expect(
      b.commandResponseRefusal(commandId, 'tab-a', {
        callerUserId: 'user-a',
        streamId: '00000000-0000-4000-8000-000000000000',
      })
    ).toBe('STREAM_MISMATCH');

    // Posted on an instance that knows nothing of the command: it is forwarded
    // with who answered, and the instance holding it refuses it.
    expect(c.resolveCommand(commandId, forged, 'tab-a', { callerUserId: 'user-b' })).toBe(true);

    // The owner's genuine result, from any instance, settles it.
    expect(
      c.resolveCommand(commandId, { answeredBy: 'tab-a' }, 'tab-a', {
        callerUserId: 'user-a',
        streamId: stream.streamId,
      })
    ).toBe(true);
    expect(await answer).toEqual({ answeredBy: 'tab-a' });

    stream.unsubscribe();
    for (const instance of [a, b, c]) instance.destroy();
    await bus.close();
  });
});
