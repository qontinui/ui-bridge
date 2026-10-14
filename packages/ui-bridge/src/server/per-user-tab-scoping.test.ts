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
import { createRelayHandlers } from './relay-handlers';

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
  async isTabKnown(tabId: string): Promise<boolean | null> {
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

  // U2 (P1 security): `getTransportDiagnostics` is what `GET /health` spreads.
  // Unscoped it hands EVERY authenticated caller the whole registry — the
  // cross-user tab-id enumeration leak that routed around the `/tabs` gate.
  it('getTransportDiagnostics({ownerCheck}) filters every tab-identifying field', () => {
    const relay = freshRelay();
    registerOwnedTab(relay, 'tab-a', 'alice');
    registerOwnedTab(relay, 'tab-b', 'bob');
    relay.subscribeToCommands(() => {}, 'tab-c'); // unregistered → nobody's
    relay.receiveHeartbeat('tab-a', { url: 'https://a', title: 'A', visibility: 'visible' });
    relay.receiveHeartbeat('tab-b', { url: 'https://b', title: 'B', visibility: 'visible' });

    const scoped = relay.getTransportDiagnostics({ ownerCheck: { userId: 'alice' } });
    expect(scoped.connectedTabs).toEqual(['tab-a']);
    expect(scoped.activeTabs).toEqual(['tab-a']);
    expect(Object.keys(scoped.tabHeartbeats)).toEqual(['tab-a']);
    expect(Object.keys(scoped.tabMetadata)).toEqual(['tab-a']);
    expect(Object.keys(scoped.tabOwnership)).toEqual(['tab-a']);
    expect(scoped.commandListenerCount).toBe(1);
    expect(scoped.pendingCommandIds).toEqual([]);
    // Strict mode: an unregistered tab belongs to nobody, not to everybody.
    expect(JSON.stringify(scoped)).not.toContain('tab-c');
    expect(JSON.stringify(scoped)).not.toContain('tab-b');

    // A caller with no tabs enumerates nothing.
    const eve = relay.getTransportDiagnostics({ ownerCheck: { userId: 'eve' } });
    expect(eve.connectedTabs).toEqual([]);
    expect(eve.tabOwnership).toEqual({});
    expect(eve.primaryTabId).toBeNull();

    // No ownerCheck → the unchanged admin view.
    const admin = relay.getTransportDiagnostics();
    expect(admin.connectedTabs.sort()).toEqual(['tab-a', 'tab-b', 'tab-c']);
    expect(Object.keys(admin.tabOwnership).sort()).toEqual(['tab-a', 'tab-b']);
  });

  it('isAppResponsive/getLastHeartbeat({ownerCheck}) do not bleed another user liveness', () => {
    const relay = freshRelay();
    registerOwnedTab(relay, 'tab-b', 'bob');
    relay.receiveHeartbeat('tab-b', { url: 'https://b', title: 'B', visibility: 'visible' });

    expect(relay.isAppResponsive()).toBe(true);
    expect(relay.getLastHeartbeat()).toBeGreaterThan(0);

    // Alice owns nothing — bob's heartbeat is not hers to read.
    expect(relay.isAppResponsive({ ownerCheck: { userId: 'alice' } })).toBe(false);
    expect(relay.getLastHeartbeat({ ownerCheck: { userId: 'alice' } })).toBe(0);
    expect(relay.isAppResponsive({ ownerCheck: { userId: 'bob' } })).toBe(true);
  });

  it('SSE unsubscribe drops the ownership record', () => {
    const relay = freshRelay();
    const tab = registerOwnedTab(relay, 'tab-a', 'alice');
    expect(relay.getOwnership('tab-a')).not.toBeNull();
    tab.unsubscribe();
    expect(relay.getOwnership('tab-a')).toBeNull();
  });
});

// U4 (P1 security): `recordRegistration` is the ONLY place tab ownership
// is written. The claimed `userId` rides in the (browser-supplied)
// heartbeat body, so on its own it is untrusted: without a proof gate,
// anyone who learns a victim's `tabId` could POST a heartbeat asserting
// any `userId` and silently seize the tab. Ownership may only be
// claimed/transferred under an AUTH-PROVEN identity (`X-Caller-User-Id`,
// injected server-side by the consumer's auth gate) that matches the
// claimed userId. A genuine re-login carries the new user's proof and
// still transfers; a self-asserted claim is refused, prior owner intact.
describe('§4.2 · recordRegistration ownership-transfer proof gate', () => {
  /** A verified caller opens `tabId`'s command stream and registers it. */
  function ownVerified(relay: CommandRelay, tabId: string, userId: string) {
    const stream = relay.openCommandStream(() => {}, tabId, userId);
    const claim = relay.recordRegistration(
      tabId,
      { userId, sessionId: `${userId}-s1` },
      { callerUserId: userId },
    );
    expect(claim.ownershipAssigned).toBe(true);
    return stream;
  }

  it('refuses an ownership takeover asserted without a matching proven identity', () => {
    const relay = freshRelay();
    // Alice legitimately owns her tab (proven identity == claimed userId).
    ownVerified(relay, 'victim-tab', 'alice');
    expect(relay.getOwnership('victim-tab')).toMatchObject({ userId: 'alice' });

    // Attacker knows `victim-tab`, supplies no proven identity
    // (unauthenticated / no X-Caller-User-Id) and asserts `mallory` in the
    // body to grab the tab. Refused — an unproven claim never transfers.
    const stolen = relay.recordRegistration(
      'victim-tab',
      { userId: 'mallory', sessionId: 'mallory-s1' },
      { callerUserId: undefined },
    );
    expect(stolen.ownershipAssigned).toBe(false);
    expect(stolen.rejectedReason).toBe('OWNER_CHANGE_UNVERIFIED');

    // Ownership is unchanged: still alice's tab.
    expect(relay.getOwnership('victim-tab')).toMatchObject({ userId: 'alice' });
  });

  it('refuses a body-asserted userId that the proven caller cannot back', () => {
    const relay = freshRelay();
    ownVerified(relay, 'victim-tab', 'alice');

    // Classic exploit: attacker (proven `mallory`) POSTs a heartbeat that
    // *claims* to be alice in the body to pass any naive body-only check.
    const res = relay.recordRegistration(
      'victim-tab',
      { userId: 'alice', sessionId: 'attacker-session' },
      { callerUserId: 'mallory' },
    );
    expect(res.ownershipAssigned).toBe(false);
    expect(res.rejectedReason).toBe('OWNER_CHANGE_UNVERIFIED');
    // sessionId was NOT overwritten by the attacker.
    expect(relay.getOwnership('victim-tab')).toMatchObject({
      userId: 'alice',
      sessionId: 'alice-s1',
    });
  });

  it("refuses an unproven refresh of a verified owner's session", () => {
    const relay = freshRelay();
    ownVerified(relay, 'victim-tab', 'alice');
    // No proof, but the right userId: it would keep alice's session "live".
    const res = relay.recordRegistration('victim-tab', { userId: 'alice', sessionId: 'forged' });
    expect(res).toEqual({ ownershipAssigned: false, rejectedReason: 'OWNER_CHANGE_UNVERIFIED' });
    expect(relay.getOwnership('victim-tab')).toMatchObject({ sessionId: 'alice-s1' });
  });

  it("a quiet owner's tab cannot be transferred while the owner's stream is open", () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const relay = freshRelay({ tabActiveWindowMs: 30_000 });
      ownVerified(relay, 'shared-tab', 'alice');
      // Alice's heartbeats stop (an expired session, a sleeping laptop) but her
      // stream stays open, so the tab's commands still reach her browser.
      vi.setSystemTime(Date.now() + 60_000);
      const takeover = relay.recordRegistration(
        'shared-tab',
        { userId: 'bob', sessionId: 'bob-s1' },
        { callerUserId: 'bob' },
      );
      expect(takeover).toEqual({ ownershipAssigned: false, rejectedReason: 'OWNER_CHANGE_UNVERIFIED' });
      expect(relay.getOwnership('shared-tab')).toMatchObject({ userId: 'alice' });
      relay.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a re-login reopens the stream under the new identity and claims the tab afresh', () => {
    const relay = freshRelay();
    const aliceStream = ownVerified(relay, 'shared-tab', 'alice');
    // Same physical browser tab; the operator logs out of alice and into bob.
    // Bob cannot open the stream while alice holds the tab...
    expect(() => relay.openCommandStream(() => {}, 'shared-tab', 'bob')).toThrow(OwnerMismatchError);
    // ...so the old stream closes, which ends alice's ownership...
    aliceStream.unsubscribe();
    expect(relay.getOwnership('shared-tab')).toBeNull();
    // ...and bob reopens it and registers the tab.
    relay.openCommandStream(() => {}, 'shared-tab', 'bob');
    const relogin = relay.recordRegistration(
      'shared-tab',
      { userId: 'bob', sessionId: 'bob-s1' },
      { callerUserId: 'bob' },
    );
    expect(relogin.ownershipAssigned).toBe(true);
    expect(relay.getOwnership('shared-tab')).toMatchObject({ userId: 'bob', sessionId: 'bob-s1' });
    relay.destroy();
  });

  it("an id claimed while its owner's stream reconnects does not lock the owner out", () => {
    const relay = freshRelay();
    const aliceStream = ownVerified(relay, 'tab-a', 'alice');
    aliceStream.unsubscribe();
    // Between alice's stream closing and her reconnect, mallory claims the id.
    relay.recordRegistration('tab-a', { userId: 'mallory', sessionId: 'm1' }, { callerUserId: 'mallory' });
    // Alice reconnects and re-registers her tab; the heartbeat-only record is gone.
    ownVerified(relay, 'tab-a', 'alice');
    // And mallory can no longer claim it.
    const again = relay.recordRegistration(
      'tab-a',
      { userId: 'mallory', sessionId: 'm1' },
      { callerUserId: 'mallory' },
    );
    expect(again).toEqual({ ownershipAssigned: false, rejectedReason: 'OWNER_CHANGE_UNVERIFIED' });
    expect(relay.getOwnership('tab-a')).toMatchObject({ userId: 'alice' });
    relay.destroy();
  });

  it("only the stream's holder is told its stream is bound to another identity", () => {
    const relay = freshRelay();
    const aliceStream = ownVerified(relay, 'tab-a', 'alice');
    const claim = (streamId?: string) =>
      relay.recordRegistration(
        'tab-a',
        { userId: 'bob', sessionId: 'b1' },
        { callerUserId: 'bob', ...(streamId ? { streamId } : {}) },
      );
    // The page holding alice's stream re-logged in as bob.
    expect(claim(aliceStream.streamId)).toEqual({
      ownershipAssigned: false,
      rejectedReason: 'STREAM_IDENTITY_CHANGED',
    });
    // Anyone else learns nothing more than a refusal.
    expect(claim()).toEqual({ ownershipAssigned: false, rejectedReason: 'OWNER_CHANGE_UNVERIFIED' });
    expect(claim('00000000-0000-4000-8000-000000000000')).toEqual({
      ownershipAssigned: false,
      rejectedReason: 'OWNER_CHANGE_UNVERIFIED',
    });
    relay.destroy();
  });

  it('a tab with no stream here transfers to a proven re-login once the owner has gone quiet', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // The tab streams on another instance; heartbeats reach this one.
      const relay = freshRelay({ tabActiveWindowMs: 30_000 });
      relay.recordRegistration('far-tab', { userId: 'alice', sessionId: 'a1' }, { callerUserId: 'alice' });
      const early = relay.recordRegistration(
        'far-tab',
        { userId: 'bob', sessionId: 'b1' },
        { callerUserId: 'bob' },
      );
      expect(early).toEqual({ ownershipAssigned: false, rejectedReason: 'OWNER_SESSION_LIVE' });
      vi.setSystemTime(Date.now() + 30_001);
      const late = relay.recordRegistration(
        'far-tab',
        { userId: 'bob', sessionId: 'b1' },
        { callerUserId: 'bob' },
      );
      expect(late.ownershipAssigned).toBe(true);
      expect(relay.getOwnership('far-tab')).toMatchObject({ userId: 'bob' });
      relay.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a heartbeat-only record holds the tab while the owner's stream is live on another instance", async () => {
    const bus = new InMemoryBus();
    const prefix = Math.random().toString(36).slice(2, 8);
    const a = freshRelay({ bus, globalPrefix: `__scopeA_${prefix}` });
    const b = freshRelay({ bus, globalPrefix: `__scopeB_${prefix}` });
    // alice's stream is on A; her heartbeats also land on B.
    ownVerified(a, 'tab-a', 'alice');
    b.recordRegistration('tab-a', { userId: 'alice', sessionId: 'a1' }, { callerUserId: 'alice' });

    // mallory knows the id and opens its stream on B: refused, record kept.
    const streamedElsewhere = await b.isTabStreamedElsewhere('tab-a');
    expect(streamedElsewhere).toBe(true);
    expect(() =>
      b.openCommandStream(() => {}, 'tab-a', 'mallory', { streamedElsewhere }),
    ).toThrow(OwnerMismatchError);
    // With a bus and no answer (none asked, or the registry unreadable), the
    // tab is held too.
    expect(() => b.openCommandStream(() => {}, 'tab-a', 'mallory')).toThrow(OwnerMismatchError);
    expect(() =>
      b.openCommandStream(() => {}, 'tab-a', 'mallory', { streamedElsewhere: null }),
    ).toThrow(OwnerMismatchError);
    // An unreadable registry reads as unknown, never as absent.
    bus.isTabKnown = async () => null;
    expect(await b.isTabStreamedElsewhere('tab-a')).toBeNull();
    expect(b.getOwnership('tab-a')).toMatchObject({ userId: 'alice' });

    a.destroy();
    b.destroy();
    await bus.close();
  });

  it('a stream opened with no identity cannot replace a verified one', () => {
    const relay = freshRelay();
    ownVerified(relay, 'tab-a', 'alice');
    expect(() => relay.openCommandStream(() => {}, 'tab-a', undefined)).toThrow(OwnerMismatchError);
    expect(relay.getOwnership('tab-a')).toMatchObject({ userId: 'alice' });
    relay.destroy();
  });

  it('leaves the current owner heartbeat path unchanged (same-owner refresh)', () => {
    const relay = freshRelay();
    ownVerified(relay, 'my-tab', 'alice');
    const first = relay.getOwnership('my-tab');

    // Ordinary heartbeat refresh from the current owner: sessionId updates,
    // firstSeen sticks, ownership assigned.
    const refresh = relay.recordRegistration(
      'my-tab',
      { userId: 'alice', sessionId: 'alice-s2' },
      { callerUserId: 'alice' },
    );
    expect(refresh.ownershipAssigned).toBe(true);
    const after = relay.getOwnership('my-tab');
    expect(after).toMatchObject({ userId: 'alice', sessionId: 'alice-s2' });
    expect(after!.firstSeen).toBe(first!.firstSeen);
  });

  it('header-less: first claim + same-owner refresh work; a no-proof TRANSFER is refused', () => {
    // Header-less deployment (no per-user boundary). A single-user app never
    // changes userId, so it only ever hits the first-claim + refresh paths,
    // which stay working. But an unauthenticated TRANSFER to a different
    // user is exactly the takeover the fix closes — refuse it, fail closed.
    const relay = freshRelay();
    const claim = relay.recordRegistration('tab-x', { userId: 'alice', sessionId: 's1' });
    expect(claim.ownershipAssigned).toBe(true);

    const refresh = relay.recordRegistration('tab-x', { userId: 'alice', sessionId: 's2' });
    expect(refresh.ownershipAssigned).toBe(true);
    expect(relay.getOwnership('tab-x')).toMatchObject({ userId: 'alice', sessionId: 's2' });

    const transfer = relay.recordRegistration('tab-x', { userId: 'bob', sessionId: 's3' });
    expect(transfer.ownershipAssigned).toBe(false);
    expect(transfer.rejectedReason).toBe('OWNER_CHANGE_UNVERIFIED');
    expect(relay.getOwnership('tab-x')).toMatchObject({ userId: 'alice' });
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

  it('a scoped caller reads a tab another instance refuses it exactly like a missing tab', async () => {
    // One clock for both answers, so they can be compared whole.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const bus = new InMemoryBus();
    const instA = new CommandRelay({ globalPrefix: '__instAHeldElsewhere_test', bus });
    const instB = new CommandRelay({ globalPrefix: '__instBHeldElsewhere_test', bus });
    try {
      const delivered: string[] = [];
      instB.subscribeToCommands((cmd) => delivered.push(cmd.commandId), 'tab-1');
      instB.recordRegistration('tab-1', { userId: 'bob', sessionId: 's' });

      const handlers = createRelayHandlers(instA);
      const held = await handlers.getElements({ tabId: 'tab-1' }, { callerUserId: 'eve' });
      const missing = await handlers.getElements({ tabId: 'tab-absent' }, { callerUserId: 'eve' });

      expect(delivered).toHaveLength(0);
      expect(held).toMatchObject({ success: false, code: 'TAB_NOT_FOUND', httpStatus: 404 });
      expect(held).toEqual(missing);
    } finally {
      instA.destroy();
      instB.destroy();
      vi.useRealTimers();
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
