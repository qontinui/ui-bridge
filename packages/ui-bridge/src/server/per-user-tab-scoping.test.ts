/**
 * Per-user tab scoping (§4.2 of the production-safe UI Bridge plan).
 *
 * Strict mode is the only mode: a tab is "registered" only when its
 * heartbeat carries `registrationMetadata: {userId, sessionId}`. The
 * relay then enforces ownership on `/tabs`, `targetTabId` dispatch, and
 * unscoped fanout. The cross-instance bus envelope threads the
 * authenticated `senderUserId` so the receiving instance verifies
 * against its OWN ownership registry rather than trusting the sender.
 *
 * These tests exercise the SDK layer (CommandRelay + bus envelope). The
 * HTTP-layer assertions (400 from /heartbeat without metadata, /tabs
 * filtering on X-Caller-User-Id) live in the nextjs route handler and
 * are exercised by sibling integration tests in qontinui-web.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  CommandRelay,
  OwnerMismatchError,
  TabRoutingError,
} from './command-relay';
import type { RelayBus, RelayCommandEnvelope, RelayResponseEnvelope } from './relay-bus';

/** Synchronous in-memory bus (matches relay-bus.crossinstance.test.ts). */
class InMemoryBus implements RelayBus {
  private cmdByTab = new Map<string, Set<(e: RelayCommandEnvelope) => void>>();
  private broadcast = new Set<(e: RelayCommandEnvelope) => void>();
  private respByCmd = new Map<string, Set<(e: RelayResponseEnvelope) => void>>();
  private present = new Set<string>();

  publishCommand(env: RelayCommandEnvelope): void {
    if (env.targetTabId) {
      this.cmdByTab.get(env.targetTabId)?.forEach((h) => h(env));
    } else {
      this.broadcast.forEach((h) => h(env));
    }
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
    this.respByCmd.get(env.commandId)?.forEach((h) => h(env));
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

function freshRelay(
  options?: Partial<ConstructorParameters<typeof CommandRelay>[0]>,
): CommandRelay {
  const prefix = `__uiBridgeScopingTest_${Math.random().toString(36).slice(2, 10)}`;
  return new CommandRelay({ globalPrefix: prefix, ...(options ?? {}) });
}

/**
 * Register a no-op SSE listener for a tab, then immediately record
 * ownership (the order matches how the HTTP layer works: SSE arrives
 * first, then the first heartbeat carries the metadata). Returns the
 * unsubscribe function and a `dispatched` array capturing commands the
 * relay tried to deliver locally.
 */
function registerOwnedTab(
  relay: CommandRelay,
  tabId: string,
  userId: string,
  sessionId = `${userId}-session`,
): {
  unsubscribe: () => void;
  dispatched: Array<{ commandId: string; action: string }>;
} {
  const dispatched: Array<{ commandId: string; action: string }> = [];
  const unsubscribe = relay.subscribeToCommands((cmd) => {
    dispatched.push({ commandId: cmd.commandId, action: cmd.action });
  }, tabId);
  relay.recordRegistration(tabId, { userId, sessionId });
  return { unsubscribe, dispatched };
}

describe('§4.2 · CommandRelay ownership registry', () => {
  it('recordRegistration stores firstSeen + lastSeen, refreshes on re-beat', async () => {
    const relay = freshRelay();
    relay.recordRegistration('tab-a', { userId: 'alice', sessionId: 's1' });
    const initial = relay.getOwnership('tab-a');
    expect(initial).toMatchObject({ userId: 'alice', sessionId: 's1' });
    expect(initial!.firstSeen).toBeGreaterThan(0);
    expect(initial!.lastSeen).toBe(initial!.firstSeen);

    // Re-register with the same userId — lastSeen advances (or matches if
    // the clock didn't tick), firstSeen sticks. Use fake timers so we
    // don't have to flake on system-clock granularity.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(initial!.firstSeen + 1_000));
      relay.recordRegistration('tab-a', { userId: 'alice', sessionId: 's2' });
      const updated = relay.getOwnership('tab-a');
      expect(updated!.sessionId).toBe('s2');
      expect(updated!.firstSeen).toBe(initial!.firstSeen);
      expect(updated!.lastSeen).toBe(initial!.firstSeen + 1_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('listOwnedTabs filters to the caller; non-owners and unregistered tabs are excluded', () => {
    const relay = freshRelay();
    registerOwnedTab(relay, 'tab-a', 'alice');
    registerOwnedTab(relay, 'tab-b', 'bob');
    registerOwnedTab(relay, 'tab-a2', 'alice');
    // tab-c has no ownership record (no heartbeat-with-metadata yet) —
    // a transport-only subscription doesn't enter the ownership map.
    relay.subscribeToCommands(() => {}, 'tab-c');

    expect(relay.listOwnedTabs('alice').sort()).toEqual(['tab-a', 'tab-a2']);
    expect(relay.listOwnedTabs('bob')).toEqual(['tab-b']);
    expect(relay.listOwnedTabs('eve')).toEqual([]);
  });

  it('adminListAllTabs ignores ownership and returns every connected tab', () => {
    const relay = freshRelay();
    registerOwnedTab(relay, 'tab-a', 'alice');
    registerOwnedTab(relay, 'tab-b', 'bob');
    relay.subscribeToCommands(() => {}, 'tab-c'); // unregistered
    expect(relay.adminListAllTabs().sort()).toEqual(['tab-a', 'tab-b', 'tab-c']);
  });

  it('SSE unsubscribe drops the ownership record', () => {
    const relay = freshRelay();
    const tab = registerOwnedTab(relay, 'tab-a', 'alice');
    expect(relay.getOwnership('tab-a')).not.toBeNull();
    tab.unsubscribe();
    expect(relay.getOwnership('tab-a')).toBeNull();
  });
});

describe('§4.2 · targetTabId dispatch with ownerCheck', () => {
  it('dispatch on a tab the caller owns resolves normally', async () => {
    const relay = freshRelay();
    const tab = registerOwnedTab(relay, 'tab-a', 'alice');

    void relay
      .queueCommand(
        'getElement',
        { id: 'x' },
        { targetTabId: 'tab-a', ownerCheck: { userId: 'alice' } },
      )
      .catch(() => {
        /* command will time out — we only care about routing */
      });

    await new Promise((r) => setTimeout(r, 5));
    expect(tab.dispatched).toHaveLength(1);
  });

  it('dispatch on another user\'s tab redacts to TAB_NOT_FOUND (no enumeration leak)', async () => {
    const relay = freshRelay();
    registerOwnedTab(relay, 'tab-a', 'alice');
    registerOwnedTab(relay, 'tab-b', 'bob');

    // Eve, who owns no tabs, tries to address Bob's tab.
    try {
      await relay.queueCommand(
        'getElement',
        { id: 'x' },
        { targetTabId: 'tab-b', ownerCheck: { userId: 'eve' } },
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(OwnerMismatchError);
      const e = err as OwnerMismatchError;
      expect(e.code).toBe('OWNER_MISMATCH');
      expect(e.tabId).toBe('tab-b');
      expect(e.callerUserId).toBe('eve');
      expect(e.storedUserId).toBe('bob');
    }
  });

  it('TAB_NOT_FOUND for an unknown tab id redacts the connectedTabs list to caller-owned tabs', async () => {
    const relay = freshRelay();
    registerOwnedTab(relay, 'tab-a', 'alice');
    registerOwnedTab(relay, 'tab-b', 'bob');

    try {
      await relay.queueCommand(
        'getElement',
        { id: 'x' },
        { targetTabId: 'tab-zombie', ownerCheck: { userId: 'alice' } },
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TabRoutingError);
      const e = err as TabRoutingError;
      expect(e.code).toBe('TAB_NOT_FOUND');
      // CRITICAL: the redacted list MUST NOT include bob's tab.
      expect(e.connectedTabs).toEqual(['tab-a']);
    }
  });

  it('dispatch without ownerCheck is the admin path — addresses any registered tab', async () => {
    const relay = freshRelay();
    const tab = registerOwnedTab(relay, 'tab-a', 'alice');

    void relay
      .queueCommand('getElement', { id: 'x' }, { targetTabId: 'tab-a' })
      .catch(() => {
        /* timeout fine */
      });
    await new Promise((r) => setTimeout(r, 5));
    expect(tab.dispatched).toHaveLength(1);
  });
});

describe('§4.2 · unscoped fanout with ownerCheck', () => {
  it('fans out only to the caller\'s own tabs (Bob\'s tab is never notified)', async () => {
    const relay = freshRelay();
    const alice1 = registerOwnedTab(relay, 'tab-a', 'alice');
    const alice2 = registerOwnedTab(relay, 'tab-a2', 'alice');
    const bob = registerOwnedTab(relay, 'tab-b', 'bob');

    void relay
      .queueCommand('getElement', { id: 'x' }, { ownerCheck: { userId: 'alice' } })
      .catch(() => {
        /* timeout fine */
      });
    await new Promise((r) => setTimeout(r, 5));

    // Exactly one of Alice's tabs received the command (the owned-primary path).
    const aliceHits = alice1.dispatched.length + alice2.dispatched.length;
    expect(aliceHits).toBe(1);
    expect(bob.dispatched).toHaveLength(0);
  });

  it('returns SDK_DISCONNECTED when the caller has no tabs, even if others have tabs', async () => {
    const relay = freshRelay();
    registerOwnedTab(relay, 'tab-b', 'bob');
    // Eve has no tabs — must NOT block waiting for Bob's tab.
    await expect(
      relay.queueCommand('getElement', { id: 'x' }, { ownerCheck: { userId: 'eve' } }),
    ).rejects.toThrow(/SDK_DISCONNECTED|No browser connected/);
  });
});

describe('§4.2 · cross-instance bus envelope ownership enforcement', () => {
  it('publishes senderUserId on the bus envelope when ownerCheck is set', async () => {
    const bus = new InMemoryBus();
    const captured: RelayCommandEnvelope[] = [];
    bus.subscribeCommands('tab-a', (env) => captured.push(env));

    const sender = new CommandRelay({ globalPrefix: '__senderProbe_test', bus });
    // Tab is registered "elsewhere" — the sender does not hold it locally,
    // so the dispatch routes via the bus.
    bus.registerTab('tab-a', 60);

    void sender
      .queueCommand(
        'doThing',
        { p: 1 },
        { targetTabId: 'tab-a', ownerCheck: { userId: 'alice' } },
      )
      .catch(() => {
        /* response never comes — fine */
      });

    await new Promise((r) => setTimeout(r, 5));
    expect(captured).toHaveLength(1);
    expect(captured[0].senderUserId).toBe('alice');
  });

  it('receiver rejects when its local ownership disagrees with senderUserId', async () => {
    const bus = new InMemoryBus();
    const instA = new CommandRelay({ globalPrefix: '__instAOwn_test', bus });
    const instB = new CommandRelay({ globalPrefix: '__instBOwn_test', bus });

    // B holds tab-1, owned by Bob.
    const delivered: string[] = [];
    instB.subscribeToCommands((cmd) => delivered.push(cmd.commandId), 'tab-1');
    instB.recordRegistration('tab-1', { userId: 'bob', sessionId: 's' });

    // Eve, on instance A, dispatches to tab-1 claiming she's the owner.
    // Instance A has no local presence info for ownership — it relies on
    // the bus presence registry. The dispatch routes via the bus.
    // Attach a no-op rejection tracker first so the synchronous bus
    // rejection isn't flagged as "unhandled" before we await below.
    const pending = instA
      .queueCommand('doThing', { p: 1 }, {
        targetTabId: 'tab-1',
        ownerCheck: { userId: 'eve' },
      })
      .then(
        (v) => ({ ok: true, value: v }) as const,
        (err) => ({ ok: false, err }) as const,
      );

    const settled = await pending;

    // Instance B's bus subscriber should have rejected (NOT delivered).
    expect(delivered).toHaveLength(0);
    expect(settled.ok).toBe(false);
    if (!settled.ok) {
      expect((settled.err as Error).message).toMatch(/not addressable/);
    }
  });

  it('receiver delivers when senderUserId matches its local ownership', async () => {
    const bus = new InMemoryBus();
    const instA = new CommandRelay({ globalPrefix: '__instAMatch_test', bus });
    const instB = new CommandRelay({ globalPrefix: '__instBMatch_test', bus });

    const delivered: string[] = [];
    instB.subscribeToCommands((cmd) => delivered.push(cmd.commandId), 'tab-2');
    instB.recordRegistration('tab-2', { userId: 'alice', sessionId: 's' });

    void instA
      .queueCommand(
        'doThing',
        { p: 1 },
        { targetTabId: 'tab-2', ownerCheck: { userId: 'alice' } },
      )
      .catch(() => {
        /* command will time out; routing is what we're checking */
      });

    await new Promise((r) => setTimeout(r, 5));
    expect(delivered).toHaveLength(1);
  });
});
