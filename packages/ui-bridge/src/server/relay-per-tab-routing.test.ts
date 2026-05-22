/**
 * Tier-2 relay remediation tests — per-tab `tabId` routing (Item #4) +
 * stale-tab TTL pruning (Item #15).
 *
 * Item #4 — per-tab dispatch
 *   Multi-tab installs (e.g. two operator machines on the same Vercel
 *   deployment) cannot rely on `primaryTabId`: it flips to the most recently
 *   registered tab and races command dispatch. These tests pin commands to
 *   specific tabs via the `targetTabId` option and assert the relay returns
 *   the documented `TAB_NOT_FOUND` / `TAB_STALE` codes when the target is
 *   unreachable, instead of silently broadcasting or hanging.
 *
 * Item #15 — stale-tab pruning
 *   Without active pruning, a tab that dies without unsubscribing stays in
 *   `connectedTabs` forever. Once the per-tab routing lands, callers may pin
 *   commands on the zombie and wait forever. Tests drive the sweep with
 *   fake timers and assert the pruned tab disappears, the primary is
 *   demoted, and the `tab.pruned` event is emitted.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { CommandRelay, TabRoutingError } from './command-relay';
import { createRelayHandlers } from './relay-handlers';

function freshRelay(options?: Partial<ConstructorParameters<typeof CommandRelay>[0]>): CommandRelay {
  // Each test gets its own globalThis-key prefix so persisted state does
  // not leak between tests.
  const prefix = `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`;
  return new CommandRelay({ globalPrefix: prefix, ...(options ?? {}) });
}

/**
 * Register a "tab" by subscribing a no-op listener. Returns the unsubscribe
 * fn (call to simulate the tab disconnecting cleanly) and a `dispatched`
 * array that captures commands the relay tried to deliver.
 */
function registerTab(relay: CommandRelay, tabId: string): {
  unsubscribe: () => void;
  dispatched: Array<{ commandId: string; action: string }>;
} {
  const dispatched: Array<{ commandId: string; action: string }> = [];
  const unsubscribe = relay.subscribeToCommands((cmd) => {
    dispatched.push({ commandId: cmd.commandId, action: cmd.action });
  }, tabId);
  return { unsubscribe, dispatched };
}

describe('relay · Item #4 — per-tab `targetTabId` routing', () => {
  it('throws TabRoutingError with code=TAB_NOT_FOUND when targetTabId is unknown', async () => {
    const relay = freshRelay();
    // Register tab-a so the relay isn't empty — the "no browser connected"
    // path otherwise fires and we'd never reach the per-tab validation.
    registerTab(relay, 'tab-a');

    await expect(
      relay.queueCommand('getElement', { id: 'foo' }, { targetTabId: 'tab-zombie' })
    ).rejects.toMatchObject({
      name: 'TabRoutingError',
      code: 'TAB_NOT_FOUND',
      tabId: 'tab-zombie',
    });
  });

  it('TAB_NOT_FOUND error lists the currently connected tabs', async () => {
    const relay = freshRelay();
    registerTab(relay, 'tab-a');
    registerTab(relay, 'tab-b');

    try {
      await relay.queueCommand('getElement', { id: 'foo' }, { targetTabId: 'tab-zombie' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TabRoutingError);
      const tabErr = err as TabRoutingError;
      expect(tabErr.code).toBe('TAB_NOT_FOUND');
      expect(tabErr.connectedTabs).toEqual(expect.arrayContaining(['tab-a', 'tab-b']));
      expect(tabErr.message).toContain('not in connectedTabs');
    }
  });

  it('routes to targetTabId even when primary is a different tab', async () => {
    const relay = freshRelay();
    const tabA = registerTab(relay, 'tab-a');
    const tabB = registerTab(relay, 'tab-b');

    // tab-b registered last → primary flips to tab-b. Pin to tab-a anyway.
    // We don't await the queueCommand — it would hang waiting for a response
    // chunk back from the "browser". Instead, fire-and-forget the dispatch
    // and inspect which listener received the command.
    void relay
      .queueCommand('getElement', { id: 'foo' }, { targetTabId: 'tab-a' })
      .catch(() => {
        /* command will time out; that's fine for this routing assertion */
      });

    // Allow microtasks to settle so the listener callback fires
    await new Promise((r) => setTimeout(r, 10));

    expect(tabA.dispatched).toHaveLength(1);
    expect(tabA.dispatched[0]!.action).toBe('getElement');
    expect(tabB.dispatched).toHaveLength(0);
  });

  it('default (no targetTabId) routes to current primary, preserving back-compat', async () => {
    const relay = freshRelay();
    const tabA = registerTab(relay, 'tab-a');
    const tabB = registerTab(relay, 'tab-b');

    // Primary = tab-b (last registered)
    void relay.queueCommand('getElement', { id: 'foo' }).catch(() => {
      /* timeout is fine */
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(tabA.dispatched).toHaveLength(0);
    expect(tabB.dispatched).toHaveLength(1);
  });

  it('TAB_STALE error when targetTabId is registered but heartbeat is stale', async () => {
    const relay = freshRelay({ staleHeartbeatMs: 5_000, staleHeartbeatSweepMs: 60_000 });
    registerTab(relay, 'tab-a');

    // Plant a stale heartbeat — 60s old, way past the 5s threshold.
    relay.receiveHeartbeat('tab-a', { url: 'https://example.com' });
    // Force-rewind by reaching into the (test-only) heartbeat map via a
    // public-ish path: receive a fresh beat, then reach in via the
    // diagnostics snapshot's record and patch via a second receive call
    // referencing a moment in the past — but `receiveHeartbeat()` always
    // stamps now. The cleanest way is to use fake timers.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      relay.receiveHeartbeat('tab-a');
      vi.setSystemTime(new Date('2026-01-01T00:01:00Z')); // +60s

      await expect(
        relay.queueCommand('getElement', { id: 'foo' }, { targetTabId: 'tab-a' })
      ).rejects.toMatchObject({
        name: 'TabRoutingError',
        code: 'TAB_STALE',
        tabId: 'tab-a',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('relay-handlers · Item #4 — relayCommand threads tabId through', () => {
  it('extracts tabId from payload and routes via targetTabId', async () => {
    const relay = freshRelay();
    registerTab(relay, 'tab-a');
    registerTab(relay, 'tab-b');
    const spy = vi
      .spyOn(relay, 'queueCommand')
      .mockResolvedValue({ id: 'foo' } as unknown);
    const handlers = createRelayHandlers(relay);

    // executeElementAction is the canonical /control/element/:id/action
    // dispatch. The Next.js adapter threads `tabId` into the body before
    // calling here; we simulate that directly.
    await handlers.executeElementAction!('foo', {
      action: 'click',
      tabId: 'tab-a',
    } as unknown as Parameters<typeof handlers.executeElementAction>[1]);

    expect(spy).toHaveBeenCalledTimes(1);
    const [action, payload, opts] = spy.mock.calls[0]!;
    expect(action).toBe('executeElementAction');
    expect(opts).toEqual({ targetTabId: 'tab-a' });
    // payload should NOT carry tabId — it was stripped before reaching the browser
    expect(payload).toBeDefined();
    const payloadObj = payload as Record<string, unknown>;
    const request = payloadObj?.request as Record<string, unknown> | undefined;
    expect(request?.tabId).toBeUndefined();
    expect(request?.targetTabId).toBeUndefined();
  });

  it('honors targetTabId alias in payload (internal spelling)', async () => {
    const relay = freshRelay();
    registerTab(relay, 'tab-a');
    const spy = vi
      .spyOn(relay, 'queueCommand')
      .mockResolvedValue({} as unknown);
    const handlers = createRelayHandlers(relay);

    // aiFind passes the request straight through as the relay payload.
    await handlers.aiFind!({ query: 'submit button', targetTabId: 'tab-a' } as never);

    expect(spy).toHaveBeenCalledTimes(1);
    const [action, payload, opts] = spy.mock.calls[0]!;
    expect(action).toBe('aiFind');
    expect(opts).toEqual({ targetTabId: 'tab-a' });
    // targetTabId stripped from payload — browser doesn't see it
    expect((payload as Record<string, unknown>).targetTabId).toBeUndefined();
    expect((payload as Record<string, unknown>).query).toBe('submit button');
  });

  it('returns TAB_NOT_FOUND code envelope when relay throws TabRoutingError', async () => {
    const relay = freshRelay();
    registerTab(relay, 'tab-a');
    const handlers = createRelayHandlers(relay);

    const result = await handlers.executeElementAction!('foo', {
      action: 'click',
      tabId: 'tab-zombie',
    } as unknown as Parameters<typeof handlers.executeElementAction>[1]);

    expect(result.success).toBe(false);
    expect(result.code).toBe('TAB_NOT_FOUND');
    expect(result.error).toContain('tab-zombie');
    expect(result.error).toContain('connectedTabs');
  });
});

describe('relay · Item #15 — stale-tab pruning', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pruneStaleTabs() drops tabs whose last heartbeat exceeds staleHeartbeatMs', () => {
    const relay = freshRelay({ staleHeartbeatMs: 5_000 });
    registerTab(relay, 'tab-a');
    relay.receiveHeartbeat('tab-a');

    // Move 10s into the future, well past the 5s threshold
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));

    const pruned = relay.pruneStaleTabs();

    expect(pruned).toEqual(['tab-a']);
    expect(relay.getConnectedTabs()).not.toContain('tab-a');
    expect(relay.getActiveTabs()).not.toContain('tab-a');
  });

  it('does NOT prune tabs that have never sent a heartbeat (warmup window)', () => {
    const relay = freshRelay({ staleHeartbeatMs: 5_000 });
    registerTab(relay, 'tab-a');
    // Intentionally no receiveHeartbeat — simulate the proactive-snapshot
    // window before the SDK's first beat.

    vi.setSystemTime(new Date('2026-01-01T00:01:00Z')); // +60s

    const pruned = relay.pruneStaleTabs();

    expect(pruned).toEqual([]);
    expect(relay.getConnectedTabs()).toContain('tab-a');
  });

  it('demotes primary and elects most-recently-heartbeated successor on prune', () => {
    const relay = freshRelay({ staleHeartbeatMs: 5_000 });
    registerTab(relay, 'tab-a');
    registerTab(relay, 'tab-b');
    registerTab(relay, 'tab-c');

    // tab-c is current primary (last registered). Heartbeat plan:
    //   tab-c: T+0s   ← oldest, will go stale & be pruned
    //   tab-a: T+5s   ← survivor with older heartbeat
    //   tab-b: T+6s   ← survivor with most recent heartbeat
    // At prune time (T+8s), tab-c is 8s stale (over 5s threshold), but tab-a
    // and tab-b are still inside the threshold (3s and 2s old respectively).
    relay.receiveHeartbeat('tab-c');
    vi.setSystemTime(new Date('2026-01-01T00:00:05Z'));
    relay.receiveHeartbeat('tab-a');
    vi.setSystemTime(new Date('2026-01-01T00:00:06Z'));
    relay.receiveHeartbeat('tab-b');

    // Advance past tab-c's stale threshold but keep a/b active
    vi.setSystemTime(new Date('2026-01-01T00:00:08Z'));

    const pruned = relay.pruneStaleTabs();
    expect(pruned).toEqual(['tab-c']);
    // Survivors are tab-a and tab-b. Successor = most recent heartbeat = tab-b.
    expect(relay.getTransportDiagnostics().primaryTabId).toBe('tab-b');
  });

  it('emits a structured tab.pruned log line', () => {
    const relay = freshRelay({ staleHeartbeatMs: 5_000 });
    registerTab(relay, 'tab-a');
    relay.receiveHeartbeat('tab-a');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));
    relay.pruneStaleTabs();

    const prunedLogs = logSpy.mock.calls
      .map((args) => args.join(' '))
      .filter((line) => line.includes('tab.pruned'));
    expect(prunedLogs.length).toBeGreaterThan(0);
    const parsed = JSON.parse(prunedLogs[0]!.replace(/^\[ui-bridge\] /, ''));
    expect(parsed.event).toBe('tab.pruned');
    expect(parsed.id).toBe('tab-a');
    expect(typeof parsed.age_ms).toBe('number');
    expect(parsed.age_ms).toBeGreaterThanOrEqual(5_000);

    logSpy.mockRestore();
  });

  it('getActiveTabs() filters out stale tabs without mutating connectedTabs', () => {
    const relay = freshRelay({ staleHeartbeatMs: 5_000 });
    registerTab(relay, 'tab-a');
    registerTab(relay, 'tab-b');
    relay.receiveHeartbeat('tab-a');
    relay.receiveHeartbeat('tab-b');

    vi.setSystemTime(new Date('2026-01-01T00:00:03Z'));
    relay.receiveHeartbeat('tab-a'); // tab-a freshly beat at +3s

    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));
    // tab-b last beat at T+0 → 10s stale. tab-a last beat at +3s → 7s stale.
    // With threshold 5s, both are stale.
    expect(relay.getActiveTabs()).toEqual([]);

    relay.receiveHeartbeat('tab-a'); // freshen tab-a only
    expect(relay.getActiveTabs()).toEqual(['tab-a']);
    // No prune was called, so connectedTabs still reports both.
    expect(relay.getConnectedTabs()).toEqual(expect.arrayContaining(['tab-a', 'tab-b']));
  });

  it('isTabActive returns true for unknown-heartbeat tabs (warmup) and false for stale ones', () => {
    const relay = freshRelay({ staleHeartbeatMs: 5_000 });
    registerTab(relay, 'tab-a');
    expect(relay.isTabActive('tab-a')).toBe(true); // no heartbeat yet → warmup

    relay.receiveHeartbeat('tab-a');
    expect(relay.isTabActive('tab-a')).toBe(true);

    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));
    expect(relay.isTabActive('tab-a')).toBe(false);
  });

  it('isTabActive returns false for unknown tab', () => {
    const relay = freshRelay();
    expect(relay.isTabActive('does-not-exist')).toBe(false);
  });

  it('exposes staleHeartbeatMs in TransportDiagnostics', () => {
    const relay = freshRelay({ staleHeartbeatMs: 12_345 });
    expect(relay.getTransportDiagnostics().staleHeartbeatMs).toBe(12_345);
    expect(relay.getTransportDiagnostics().activeTabs).toEqual([]);
  });
});
