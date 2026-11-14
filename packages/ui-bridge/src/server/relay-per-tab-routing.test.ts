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
import { createNextRouteHandlers } from './nextjs';

/** Every relay `freshRelay()` built, destroyed by `destroyRelays()` after each test. */
const relays: CommandRelay[] = [];

function destroyRelays(): void {
  for (const relay of relays.splice(0)) relay.destroy();
}

afterEach(destroyRelays);

function freshRelay(
  options?: Partial<ConstructorParameters<typeof CommandRelay>[0]>
): CommandRelay {
  // Each test gets its own globalThis-key prefix so persisted state does
  // not leak between tests. No warm-up snapshot: it would land at a time no
  // request chose, and these tests count which tab each command reached.
  const prefix = `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`;
  const relay = new CommandRelay({
    globalPrefix: prefix,
    proactiveSnapshot: false,
    ...(options ?? {}),
  });
  relays.push(relay);
  return relay;
}

/**
 * Register a "tab" by subscribing a no-op listener. Returns the unsubscribe
 * fn (call to simulate the tab disconnecting cleanly) and a `dispatched`
 * array that captures commands the relay tried to deliver.
 */
function registerTab(
  relay: CommandRelay,
  tabId: string
): {
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
    void relay.queueCommand('getElement', { id: 'foo' }, { targetTabId: 'tab-a' }).catch(() => {
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
    const relay = freshRelay({ tabActiveWindowMs: 5_000, pruneSweepIntervalMs: 60_000 });
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
    const spy = vi.spyOn(relay, 'queueCommand').mockResolvedValue({ id: 'foo' } as unknown);
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

  it('preserves windowLabel in the relayed payload while stripping tabId (Phase 1 window targeting)', async () => {
    const relay = freshRelay();
    registerTab(relay, 'tab-a');
    const spy = vi.spyOn(relay, 'queueCommand').mockResolvedValue({ id: 'foo' } as unknown);
    const handlers = createRelayHandlers(relay);

    await handlers.executeElementAction!('foo', {
      action: 'click',
      tabId: 'tab-a',
      windowLabel: 'term-2',
    } as unknown as Parameters<typeof handlers.executeElementAction>[1]);

    expect(spy).toHaveBeenCalledTimes(1);
    const [, payload, opts] = spy.mock.calls[0]!;
    // tabId is consumed as routing and stripped from the payload...
    expect(opts).toEqual({ targetTabId: 'tab-a' });
    const request = (payload as Record<string, unknown>)?.request as
      | Record<string, unknown>
      | undefined;
    expect(request?.tabId).toBeUndefined();
    expect(request?.targetTabId).toBeUndefined();
    // ...but windowLabel must SURVIVE — extractTabRouting strips only the
    // tab-routing keys, so a verbatim action body keeps its window target for
    // the direct-HTTP / runner-proxy path that reaches pop-out windows.
    expect(request?.windowLabel).toBe('term-2');
  });

  it('honors targetTabId alias in payload (internal spelling)', async () => {
    const relay = freshRelay();
    registerTab(relay, 'tab-a');
    const spy = vi.spyOn(relay, 'queueCommand').mockResolvedValue({} as unknown);
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

  it('TAB_NOT_FOUND envelope carries httpStatus=404 for adapter to translate', async () => {
    const relay = freshRelay();
    registerTab(relay, 'tab-a');
    const handlers = createRelayHandlers(relay);

    const result = await handlers.executeElementAction!('foo', {
      action: 'click',
      tabId: 'tab-zombie',
    } as unknown as Parameters<typeof handlers.executeElementAction>[1]);

    // The adapter (Express / Next.js) reads `httpStatus` off the envelope
    // and uses it as the HTTP response status, stripping it from the body.
    // 404 specifically marks "the pinned tab is not in the registry" —
    // distinct from a generic 500 and parsable without prose-matching.
    expect(result.success).toBe(false);
    expect(result.code).toBe('TAB_NOT_FOUND');
    expect((result as { httpStatus?: number }).httpStatus).toBe(404);
  });

  it('Next.js adapter returns HTTP 404 when ?tabId=<unknown>', async () => {
    // End-to-end through the Next.js route adapter: query-param `?tabId`
    // is sniffed by the adapter, threaded into the body, picked up by
    // relay-handlers' `extractTabRouting`, fails the relay's per-tab
    // validation with `TAB_NOT_FOUND`, the envelope carries
    // `httpStatus: 404`, and the adapter strips that field and returns
    // the actual HTTP 404 response.
    const relay = freshRelay();
    registerTab(relay, 'tab-a');
    const handlers = createRelayHandlers(relay);
    const route = createNextRouteHandlers(handlers);

    // Construct a minimal NextRequest-compatible object — the adapter
    // only touches `nextUrl`, `headers`, `method`, and `json()`.
    const url = new URL(
      'http://localhost/api/ui-bridge/control/element/foo/action?tabId=tab-zombie'
    );
    const req = new Request(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'click' }),
    }) as unknown as Request & { nextUrl: URL };
    req.nextUrl = url;

    const response = await route.POST(
      req as never,
      {
        params: { path: ['control', 'element', 'foo', 'action'] },
      } as never
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('TAB_NOT_FOUND');
    // httpStatus must be stripped from the JSON body — it's a transport hint
    expect(body.httpStatus).toBeUndefined();
  });

  it('Next.js adapter returns HTTP 200 when ?tabId=<known> routes successfully', async () => {
    // Default routing (no tabId or known tabId) must NOT trip the 404 path.
    // Mock the queueCommand so we don't need an end-to-end browser response.
    const relay = freshRelay();
    registerTab(relay, 'tab-a');
    vi.spyOn(relay, 'queueCommand').mockResolvedValue({ ok: true } as unknown);
    const handlers = createRelayHandlers(relay);
    const route = createNextRouteHandlers(handlers);

    const url = new URL('http://localhost/api/ui-bridge/control/element/foo/action?tabId=tab-a');
    const req = new Request(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'click', params: { text: 'hi' } }),
    }) as unknown as Request & { nextUrl: URL };
    req.nextUrl = url;

    const response = await route.POST(
      req as never,
      {
        params: { path: ['control', 'element', 'foo', 'action'] },
      } as never
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it('TAB_STALE envelope carries httpStatus=410 for adapter to translate', async () => {
    const relay = freshRelay({ tabActiveWindowMs: 5_000, pruneSweepIntervalMs: 60_000 });
    registerTab(relay, 'tab-a');
    const handlers = createRelayHandlers(relay);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      relay.receiveHeartbeat('tab-a');
      vi.setSystemTime(new Date('2026-01-01T00:01:00Z')); // +60s

      const result = await handlers.executeElementAction!('foo', {
        action: 'click',
        tabId: 'tab-a',
      } as unknown as Parameters<typeof handlers.executeElementAction>[1]);

      expect(result.success).toBe(false);
      expect(result.code).toBe('TAB_STALE');
      // 410 Gone — the tab existed but is no longer routable. Distinct
      // from 404 so callers can decide whether to retry (stale: yes,
      // wait for heartbeat) or re-discover (not-found: query /tabs).
      expect((result as { httpStatus?: number }).httpStatus).toBe(410);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('relay · Item #15 — stale-tab pruning', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    // Destroy under the fake clock, so each relay's cleanup interval is
    // cleared there. The subscriptions' proactive timeouts stay on the fake
    // clock and are dropped with it, which is harmless: destroy() leaves them
    // no listener to send to.
    destroyRelays();
    vi.useRealTimers();
  });

  // NOTE: the DESTRUCTIVE prune is gated on `zombieTransportMs`, not on
  // `tabActiveWindowMs` — the latter is the non-destructive activity threshold
  // (`getActiveTabs`/`isTabActive`). These tests therefore set the zombie knob
  // explicitly. See `relay-transport-liveness.test.ts` for why the two were
  // split: a background-throttled tab beats every ~60s, so pruning at
  // `tabActiveWindowMs` tore down healthy tabs' live SSE transports.
  it('pruneStaleTabs() drops tabs whose last heartbeat exceeds zombieTransportMs', () => {
    const relay = freshRelay({ tabActiveWindowMs: 5_000, zombieTransportMs: 5_000 });
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
    const relay = freshRelay({ tabActiveWindowMs: 5_000 });
    registerTab(relay, 'tab-a');
    // Intentionally no receiveHeartbeat — simulate the proactive-snapshot
    // window before the SDK's first beat.

    vi.setSystemTime(new Date('2026-01-01T00:01:00Z')); // +60s

    const pruned = relay.pruneStaleTabs();

    expect(pruned).toEqual([]);
    expect(relay.getConnectedTabs()).toContain('tab-a');
  });

  it('demotes primary and elects most-recently-heartbeated successor on prune', () => {
    const relay = freshRelay({ tabActiveWindowMs: 5_000, zombieTransportMs: 5_000 });
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
    const relay = freshRelay({ tabActiveWindowMs: 5_000, zombieTransportMs: 5_000 });
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
    const relay = freshRelay({ tabActiveWindowMs: 5_000 });
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
    const relay = freshRelay({ tabActiveWindowMs: 5_000 });
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

  it('exposes tabActiveWindowMs in TransportDiagnostics', () => {
    const relay = freshRelay({ tabActiveWindowMs: 12_345 });
    expect(relay.getTransportDiagnostics().tabActiveWindowMs).toBe(12_345);
    expect(relay.getTransportDiagnostics().activeTabs).toEqual([]);
  });
});

// ============================================================================
// P0 — pinned reads must NEVER be served from the shared snapshot cache
// (plan 2026-06-12 co-pilot remediation, item 1) + per-tab snapshot reads
// (item 3) + F3 registration readiness on find responses (item 5).
// ============================================================================

/** Minimal ControlSnapshot-shaped payload for seeding the relay cache. */
function snapshotWith(
  elements: Array<{ id: string; type: string; label?: string }>,
  registration?: {
    totalRegistered: number;
    everHadRegistrations: boolean;
    byRoute: Record<string, { count: number; ids: string[] }>;
  }
): Record<string, unknown> {
  return {
    timestamp: Date.now(),
    elements: elements.map((e) => ({ ...e, actions: ['click'], state: {} })),
    components: [],
    workflows: [],
    activeRuns: [],
    ...(registration ? { registration } : {}),
  };
}

/**
 * Register a tab that RESPONDS to relayed commands: each delivered command is
 * resolved (next tick) with `makeResult(action)`, attributed to this tab.
 */
function registerRespondingTab(
  relay: CommandRelay,
  tabId: string,
  makeResult: (action: string) => unknown
): void {
  relay.subscribeToCommands((cmd) => {
    setTimeout(() => {
      relay.resolveCommand(cmd.commandId, makeResult(cmd.action), tabId);
    }, 0);
  }, tabId);
}

describe('relay-handlers · pinned reads never serve the shared snapshot cache (item 1, P0)', () => {
  /** Seed `latestControlSnapshot` through the public handler surface. */
  async function seedCache(
    relay: CommandRelay,
    handlers: ReturnType<typeof createRelayHandlers>,
    snapshot: Record<string, unknown>
  ): Promise<void> {
    const spy = vi.spyOn(relay, 'queueCommand').mockResolvedValue(snapshot as never);
    const seeded = await handlers.getControlSnapshot!({ recency: 'current' });
    expect(seeded.success).toBe(true);
    spy.mockRestore();
  }

  it('pinned find to an unknown tab returns TAB_NOT_FOUND — never the cached elements', async () => {
    const relay = freshRelay();
    registerTab(relay, 'tab-a');
    const handlers = createRelayHandlers(relay);
    await seedCache(relay, handlers, snapshotWith([{ id: 'cached-el', type: 'button' }]));

    const result = await handlers.find!({ tabId: 'tab-zombie' } as never);

    expect(result.success).toBe(false);
    expect(result.code).toBe('TAB_NOT_FOUND');
    // The cached element from the OTHER tab must not leak into the response.
    expect(JSON.stringify(result)).not.toContain('cached-el');
  });

  it('pinned find whose relay leg times out propagates TIMEOUT — never the cached elements', async () => {
    const relay = freshRelay();
    registerTab(relay, 'tab-a');
    const handlers = createRelayHandlers(relay);
    await seedCache(relay, handlers, snapshotWith([{ id: 'cached-el', type: 'button' }]));

    vi.spyOn(relay, 'queueCommand').mockRejectedValue(
      new Error('Timeout waiting for browser response')
    );
    const result = await handlers.find!({ tabId: 'tab-a' } as never);

    expect(result.success).toBe(false);
    // `mapInternalErrorCode` canonicalizes TIMEOUT to the UB diagnostic code.
    expect(result.code).toBe('UB-ACTION-TIMEOUT');
    expect(JSON.stringify(result)).not.toContain('cached-el');
  });

  it('pinned find via internal targetTabId spelling also propagates the routing error', async () => {
    const relay = freshRelay();
    registerTab(relay, 'tab-a');
    const handlers = createRelayHandlers(relay);
    await seedCache(relay, handlers, snapshotWith([{ id: 'cached-el', type: 'button' }]));

    const result = await handlers.find!({ targetTabId: 'tab-zombie' } as never);

    expect(result.success).toBe(false);
    expect(result.code).toBe('TAB_NOT_FOUND');
    expect(JSON.stringify(result)).not.toContain('cached-el');
  });

  it('UNPINNED find keeps the cache fallback (back-compat) and carries the F3 registration readiness block (item 5)', async () => {
    const relay = freshRelay();
    registerTab(relay, 'tab-a');
    const handlers = createRelayHandlers(relay);
    await seedCache(
      relay,
      handlers,
      snapshotWith([], { totalRegistered: 0, everHadRegistrations: false, byRoute: {} })
    );

    vi.spyOn(relay, 'queueCommand').mockRejectedValue(
      new Error('Timeout waiting for browser response')
    );
    const result = await handlers.find!({} as never);

    // Unpinned reads keep the cached fallback...
    expect(result.success).toBe(true);
    // ...and a poller can now distinguish "not hydrated yet" from "empty":
    const data = result.data as {
      elements: unknown[];
      registration?: { everHadRegistrations: boolean };
    };
    expect(data.elements).toEqual([]);
    expect(data.registration).toBeDefined();
    expect(data.registration!.everHadRegistrations).toBe(false);
  });

  it('2-tab pinned find hits the pinned tab 10/10 (never the other tab)', async () => {
    const relay = freshRelay();
    registerRespondingTab(relay, 'tab-a', () => ({
      elements: [{ id: 'el-from-tab-a', type: 'button' }],
      total: 1,
      durationMs: 0,
      timestamp: Date.now(),
    }));
    registerRespondingTab(relay, 'tab-b', () => ({
      elements: [{ id: 'el-from-tab-b', type: 'button' }],
      total: 1,
      durationMs: 0,
      timestamp: Date.now(),
    }));
    const handlers = createRelayHandlers(relay);

    for (let i = 0; i < 10; i++) {
      const result = await handlers.find!({ tabId: 'tab-a' } as never);
      expect(result.success).toBe(true);
      const data = result.data as { elements: Array<{ id: string }> };
      expect(data.elements.map((e) => e.id)).toEqual(['el-from-tab-a']);
    }
    for (let i = 0; i < 10; i++) {
      const result = await handlers.find!({ tabId: 'tab-b' } as never);
      expect(result.success).toBe(true);
      const data = result.data as { elements: Array<{ id: string }> };
      expect(data.elements.map((e) => e.id)).toEqual(['el-from-tab-b']);
    }
  });

  it('pinned getElements / getComponents / getElement propagate routing errors instead of cache', async () => {
    const relay = freshRelay();
    registerTab(relay, 'tab-a');
    const handlers = createRelayHandlers(relay);
    await seedCache(relay, handlers, snapshotWith([{ id: 'cached-el', type: 'button' }]));

    const elements = await handlers.getElements!({ tabId: 'tab-zombie' } as never);
    expect(elements.success).toBe(false);
    expect(elements.code).toBe('TAB_NOT_FOUND');

    const components = await handlers.getComponents!({ tabId: 'tab-zombie' } as never);
    expect(components.success).toBe(false);
    expect(components.code).toBe('TAB_NOT_FOUND');

    const element = await handlers.getElement!('cached-el', { tabId: 'tab-zombie' } as never);
    expect(element.success).toBe(false);
    expect(element.code).toBe('TAB_NOT_FOUND');
  });
});

describe('relay-handlers · getControlSnapshot per-tab pinning (item 3)', () => {
  it('pinned snapshot read bypasses the warm cache and dispatches live to the pinned tab', async () => {
    const relay = freshRelay();
    registerTab(relay, 'tab-a');
    registerTab(relay, 'tab-b');
    const handlers = createRelayHandlers(relay);

    // Warm the shared cache with tab-a's data (recency 'any' would serve it).
    const seedSpy = vi
      .spyOn(relay, 'queueCommand')
      .mockResolvedValue(snapshotWith([{ id: 'el-from-tab-a', type: 'button' }]) as never);
    await handlers.getControlSnapshot!({ recency: 'current' });
    seedSpy.mockRestore();

    // Pinned read (public `tabId` spelling) must dispatch live to tab-b...
    const liveSpy = vi
      .spyOn(relay, 'queueCommand')
      .mockResolvedValue(snapshotWith([{ id: 'el-from-tab-b', type: 'button' }]) as never);
    const result = await handlers.getControlSnapshot!({
      tabId: 'tab-b',
      recency: 'any',
    } as never);

    expect(liveSpy).toHaveBeenCalledTimes(1);
    const [action, , opts] = liveSpy.mock.calls[0]!;
    expect(action).toBe('getControlSnapshot');
    expect((opts as { targetTabId?: string })?.targetTabId).toBe('tab-b');

    // ...and return tab-b's data, not the cached tab-a snapshot.
    expect(result.success).toBe(true);
    const data = result.data as { elements: Array<{ id: string }> };
    expect(data.elements.map((e) => e.id)).toEqual(['el-from-tab-b']);
  });

  it('pinned snapshot read to an unknown tab returns TAB_NOT_FOUND even with a warm cache', async () => {
    const relay = freshRelay();
    registerTab(relay, 'tab-a');
    const handlers = createRelayHandlers(relay);

    const seedSpy = vi
      .spyOn(relay, 'queueCommand')
      .mockResolvedValue(snapshotWith([{ id: 'cached-el', type: 'button' }]) as never);
    await handlers.getControlSnapshot!({ recency: 'current' });
    seedSpy.mockRestore();

    const result = await handlers.getControlSnapshot!({
      tabId: 'tab-zombie',
      recency: 'any',
    } as never);

    expect(result.success).toBe(false);
    expect(result.code).toBe('TAB_NOT_FOUND');
    expect((result as { httpStatus?: number }).httpStatus).toBe(404);
    expect(JSON.stringify(result)).not.toContain('cached-el');
  });
});

// ============================================================================
// Phase 3 of plan 2026-11-09-a-dead-relay-tab-stays-the-operators-primary-and-
// a-command-sent-during-a-stream-reopen-is-lost: selection prefers a live tab,
// a reopen keeps its standing, and a resumed stream is sent no warm-up.
//
// The measured defect (coord finding 8e6b94f2): a dead agent tab, its browser
// gone but its stream still registered because nothing told the relay, stayed
// `primaryTabId` and stayed first among its owner's tabs, so unpinned commands
// went down a stream nobody read. A tab that only reopened its stream also
// took the primary from a live tab. "Live" is `isTabLive` (tab-liveness.ts)
// over the relay's `tabActiveWindowMs`; these tests use its default, 30 000 ms,
// as a literal.
// ============================================================================

describe('relay · Phase 3 — selection prefers a live tab; a reopen keeps its standing', () => {
  const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    // Under the fake clock, as the stale-tab block above does.
    destroyRelays();
    vi.useRealTimers();
  });

  /** Move the fake clock to `ms` after T0, running no timer. */
  function at(ms: number): void {
    vi.setSystemTime(T0 + ms);
  }

  /**
   * Streams on one relay, sharing one log of `"<tabId> <action>"` deliveries.
   * A stream answers every command it is sent while its tab is `alive`. A dead
   * tab's stream stays registered, as it does when nothing tells the relay it
   * ended, and answers nothing.
   */
  function streamsOn(relay: CommandRelay) {
    const deliveries: string[] = [];
    function open(tabId: string) {
      const tab = { alive: true, close: () => {} };
      tab.close = relay.subscribeToCommands((command) => {
        deliveries.push(`${tabId} ${command.action}`);
        if (tab.alive) relay.resolveCommand(command.commandId, { answeredBy: tabId }, tabId);
      }, tabId);
      return tab;
    }
    return { deliveries, open };
  }

  /** Register each of `tabIds` to `userId`, with one heartbeat each, now. */
  function register(relay: CommandRelay, userId: string, ...tabIds: string[]): void {
    for (const tabId of tabIds) {
      relay.recordRegistration(tabId, { userId, sessionId: `session-${tabId}` });
      relay.receiveHeartbeat(tabId);
    }
  }

  /** At each offset in `atMs` (ms after T0), a heartbeat from each of `tabIds`. */
  function beat(relay: CommandRelay, atMs: number[], ...tabIds: string[]): void {
    for (const ms of atMs) {
      at(ms);
      for (const tabId of tabIds) relay.receiveHeartbeat(tabId);
    }
  }

  /**
   * Send one unpinned command, scoped to `userId` when given, and let it reach
   * a stream. Its outcome comes back unawaited, in a box: a command sent to a
   * dead tab never settles, and `destroy()` rejects it after the test.
   */
  async function sendUnpinned(relay: CommandRelay, userId?: string) {
    const outcome = relay.queueCommand(
      'getElement',
      {},
      userId ? { ownerCheck: { userId } } : undefined
    ) as Promise<{ answeredBy: string }>;
    outcome.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    return { outcome };
  }

  it('1 · a primary whose heartbeats stop yields to a live tab once tabActiveWindowMs has passed', async () => {
    const relay = freshRelay();
    const { deliveries, open } = streamsOn(relay);
    open('tab-b');
    const tabA = open('tab-a'); // registered last: the primary
    relay.receiveHeartbeat('tab-a');
    relay.receiveHeartbeat('tab-b');

    // A answers the unpinned command, and stays primary.
    const first = await sendUnpinned(relay);
    await expect(first.outcome).resolves.toEqual({ answeredBy: 'tab-a' });

    // A's browser dies: its stream stays registered, its heartbeats stop. B beats on.
    tabA.alive = false;
    beat(relay, [10_000, 20_000, 30_000], 'tab-b');
    // The window is inclusive: 30 000 ms after its last beat, A is still live.
    expect(relay.getTransportDiagnostics().primaryTabId).toBe('tab-a');

    at(30_001);
    expect(relay.getTransportDiagnostics().primaryTabId).toBe('tab-b');
    const second = await sendUnpinned(relay);
    expect(deliveries).toEqual(['tab-a getElement', 'tab-b getElement']);
    await expect(second.outcome).resolves.toEqual({ answeredBy: 'tab-b' });
  });

  it('2 · the owner-scoped arm does the same, with both tabs owned by one user', async () => {
    const relay = freshRelay();
    const { deliveries, open } = streamsOn(relay);
    open('tab-b');
    const tabA = open('tab-a');
    register(relay, 'u1', 'tab-a', 'tab-b');

    // A answers a pinned command: the owner's most recently successful tab,
    // and so first for the owner's unpinned commands.
    await expect(
      relay.queueCommand('getElement', {}, { targetTabId: 'tab-a', ownerCheck: { userId: 'u1' } })
    ).resolves.toEqual({ answeredBy: 'tab-a' });
    const first = await sendUnpinned(relay, 'u1');
    await expect(first.outcome).resolves.toEqual({ answeredBy: 'tab-a' });

    tabA.alive = false;
    beat(relay, [10_000, 20_000, 30_000], 'tab-b');
    at(30_001);
    const second = await sendUnpinned(relay, 'u1');
    expect(deliveries).toEqual(['tab-a getElement', 'tab-a getElement', 'tab-b getElement']);
    await expect(second.outcome).resolves.toEqual({ answeredBy: 'tab-b' });
  });

  it('3 · a lone tab that has gone stale is still selected, by both arms (control)', async () => {
    const relay = freshRelay();
    const { deliveries, open } = streamsOn(relay);
    open('tab-a');
    register(relay, 'u1', 'tab-a');
    at(60_000); // twice the window, well inside zombieTransportMs

    expect(relay.getTransportDiagnostics().primaryTabId).toBe('tab-a');
    expect(relay.getTransportDiagnostics({ ownerCheck: { userId: 'u1' } }).primaryTabId).toBe(
      'tab-a'
    );
    const unscoped = await sendUnpinned(relay);
    const scoped = await sendUnpinned(relay, 'u1');
    expect(deliveries).toEqual(['tab-a getElement', 'tab-a getElement']);
    await expect(unscoped.outcome).resolves.toEqual({ answeredBy: 'tab-a' });
    await expect(scoped.outcome).resolves.toEqual({ answeredBy: 'tab-a' });
  });

  it('4 · a hidden tab beating every 60 s with no fresher tab is still selected, by both arms (control)', async () => {
    const relay = freshRelay();
    const { deliveries, open } = streamsOn(relay);
    open('tab-hidden');
    register(relay, 'u1', 'tab-hidden'); // beats at 0
    for (const cycle of [0, 1, 2]) {
      // 45 s after each throttled beat: outside the window, before the next beat.
      at(cycle * 60_000 + 45_000);
      expect(relay.pruneStaleTabs()).toEqual([]);
      await sendUnpinned(relay);
      await sendUnpinned(relay, 'u1');
      beat(relay, [(cycle + 1) * 60_000], 'tab-hidden');
    }
    expect(deliveries).toEqual([
      'tab-hidden getElement',
      'tab-hidden getElement',
      'tab-hidden getElement',
      'tab-hidden getElement',
      'tab-hidden getElement',
      'tab-hidden getElement',
    ]);
  });

  it('5 · a tab that reopens its stream while another is primary and live does not take the primary', async () => {
    const relay = freshRelay();
    const { deliveries, open } = streamsOn(relay);
    open('tab-b');
    open('tab-a'); // registered last: the primary
    relay.receiveHeartbeat('tab-a');
    relay.receiveHeartbeat('tab-b');

    // B reopens (a rotation, or a reconnect after an end nobody reported)
    // while its old stream is still registered here.
    at(1_000);
    open('tab-b');

    expect(relay.getTransportDiagnostics().primaryTabId).toBe('tab-a');
    const sent = await sendUnpinned(relay);
    expect(deliveries).toEqual(['tab-a getElement']);
    await expect(sent.outcome).resolves.toEqual({ answeredBy: 'tab-a' });
  });

  it('5 · nor does one that reopens less than reconnectGraceMs after its old stream ended', () => {
    const relay = freshRelay();
    const { open } = streamsOn(relay);
    const oldB = open('tab-b');
    open('tab-a');
    relay.receiveHeartbeat('tab-a');
    relay.receiveHeartbeat('tab-b');

    at(1_000);
    oldB.close(); // the relay heard B's stream end
    at(1_000 + 4_999);
    open('tab-b');

    expect(relay.getTransportDiagnostics().primaryTabId).toBe('tab-a');
  });

  it('6 · a brand-new tab becomes primary (control)', async () => {
    const relay = freshRelay();
    const { deliveries, open } = streamsOn(relay);
    open('tab-a');
    relay.receiveHeartbeat('tab-a');

    at(1_000);
    open('tab-c');

    expect(relay.getTransportDiagnostics().primaryTabId).toBe('tab-c');
    const sent = await sendUnpinned(relay);
    expect(deliveries).toEqual(['tab-c getElement']);
    await expect(sent.outcome).resolves.toEqual({ answeredBy: 'tab-c' });
  });

  describe('7 · the warm-up getControlSnapshot', () => {
    /**
     * Open a stream that answers every command with a one-element snapshot,
     * and logs each `getControlSnapshot` it is sent under `label`.
     */
    function snapshotStream(
      relay: CommandRelay,
      tabId: string,
      label: string,
      warmUps: string[]
    ): () => void {
      return relay.subscribeToCommands((command) => {
        if (command.action === 'getControlSnapshot') warmUps.push(label);
        relay.resolveCommand(
          command.commandId,
          { elements: [{ id: 'e' }], components: [], workflows: [], timestamp: Date.now() },
          tabId
        );
      }, tabId);
    }

    it('is not sent to a stream that reopens while its old one is still registered; a new tab is sent one', async () => {
      const relay = freshRelay({ proactiveSnapshot: true });
      const warmUps: string[] = [];
      snapshotStream(relay, 'tab-a', 'tab-a stream 1', warmUps);
      // Past the 500 ms warm-up and its 1 500 ms retry.
      await vi.advanceTimersByTimeAsync(2_000);
      expect(warmUps).toEqual(['tab-a stream 1']);

      snapshotStream(relay, 'tab-a', 'tab-a stream 2', warmUps);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(warmUps).toEqual(['tab-a stream 1']);

      snapshotStream(relay, 'tab-b', 'tab-b stream 1', warmUps);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(warmUps).toEqual(['tab-a stream 1', 'tab-b stream 1']);
    });

    it('is not sent to a stream that reopens less than reconnectGraceMs after its old one ended', async () => {
      const relay = freshRelay({ proactiveSnapshot: true });
      const warmUps: string[] = [];
      const endFirst = snapshotStream(relay, 'tab-a', 'tab-a stream 1', warmUps);
      await vi.advanceTimersByTimeAsync(2_000);
      endFirst();
      await vi.advanceTimersByTimeAsync(1_000);

      snapshotStream(relay, 'tab-a', 'tab-a stream 2', warmUps);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(warmUps).toEqual(['tab-a stream 1']);
    });
  });

  it('8 · a primary that never beat here stops being live once its stream is older than the window', async () => {
    const relay = freshRelay();
    const { deliveries, open } = streamsOn(relay);
    open('tab-b');
    relay.receiveHeartbeat('tab-b');
    open('tab-a'); // never beats here; registered last: the primary
    beat(relay, [10_000, 20_000, 30_000], 'tab-b');
    // A's stream is 30 000 ms old: inside its warm-up still.
    expect(relay.getTransportDiagnostics().primaryTabId).toBe('tab-a');

    at(31_000);
    expect(relay.getTransportDiagnostics().primaryTabId).toBe('tab-b');
    const sent = await sendUnpinned(relay);
    expect(deliveries).toEqual(['tab-b getElement']);
    await expect(sent.outcome).resolves.toEqual({ answeredBy: 'tab-b' });
  });

  it("9 · a scoped primaryTabId is where the caller's own unpinned command goes, not the global primary", async () => {
    const relay = freshRelay();
    const { deliveries, open } = streamsOn(relay);
    open('tab-c'); // another user's tab
    open('tab-b');
    const tabA = open('tab-a'); // registered last: the global primary
    register(relay, 'u2', 'tab-c');
    register(relay, 'u1', 'tab-a', 'tab-b');
    // C answers its owner's pinned command: the most recently successful tab of all.
    await expect(
      relay.queueCommand('getElement', {}, { targetTabId: 'tab-c', ownerCheck: { userId: 'u2' } })
    ).resolves.toEqual({ answeredBy: 'tab-c' });

    // A dies; B and C beat on.
    tabA.alive = false;
    beat(relay, [10_000, 20_000, 30_000], 'tab-b', 'tab-c');
    at(30_001);

    // u1's view names u1's live tab...
    expect(relay.getTransportDiagnostics({ ownerCheck: { userId: 'u1' } }).primaryTabId).toBe(
      'tab-b'
    );
    // ...which is where u1's next unpinned command goes...
    const sent = await sendUnpinned(relay, 'u1');
    expect(deliveries).toEqual(['tab-c getElement', 'tab-b getElement']);
    await expect(sent.outcome).resolves.toEqual({ answeredBy: 'tab-b' });
    // ...while the global primary, chosen over every user's tabs, is C.
    expect(relay.getTransportDiagnostics().primaryTabId).toBe('tab-c');
  });

  it('selectPrimarySuccessor elects a live tab, not a stale one, when the primary is pruned', () => {
    const relay = freshRelay({ zombieTransportMs: 60_000 });
    const { open } = streamsOn(relay);
    // A tab's heartbeat can land before its stream registers: C's does.
    relay.receiveHeartbeat('tab-c');
    open('tab-b');
    beat(relay, [0, 20_000], 'tab-b');
    at(50_000);
    open('tab-a'); // never beats here
    at(55_000);
    open('tab-c'); // registered last: the primary
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      // C's beat is 61 s old: a zombie. B's is 41 s old: stale, not a zombie.
      // A never beat, and its stream is 11 s old: live.
      at(61_000);
      expect(relay.pruneStaleTabs()).toEqual(['tab-c']);
      const elected = log.mock.calls
        .map((args) => args.join(' '))
        .filter((line) => line.startsWith('[ui-bridge] Primary tab:'));
      expect(elected).toEqual(['[ui-bridge] Primary tab: tab-a']);
    } finally {
      log.mockRestore();
    }
  });

  it('judges liveness by the configured tabActiveWindowMs', () => {
    const relay = freshRelay({ tabActiveWindowMs: 5_000 });
    const { open } = streamsOn(relay);
    open('tab-b');
    open('tab-a'); // registered last: the primary
    relay.receiveHeartbeat('tab-a');
    beat(relay, [0, 5_000], 'tab-b');
    expect(relay.getTransportDiagnostics().primaryTabId).toBe('tab-a');

    at(5_001);
    expect(relay.getTransportDiagnostics().primaryTabId).toBe('tab-b');
  });

  describe('reconnectGraceMs', () => {
    const KEY = 'UI_BRIDGE_RECONNECT_GRACE_MS';
    const original = process.env[KEY];

    afterEach(() => {
      if (original === undefined) delete process.env[KEY];
      else process.env[KEY] = original;
    });

    /**
     * The primary after this: A and B stream and beat, A is primary, B's
     * stream ends 1 000 ms later, and B reopens `gapMs` after that.
     */
    function primaryAfterReopen(relay: CommandRelay, gapMs: number): string | null {
      const start = Date.now();
      const { open } = streamsOn(relay);
      const oldB = open('tab-b');
      open('tab-a');
      relay.receiveHeartbeat('tab-a');
      relay.receiveHeartbeat('tab-b');
      vi.setSystemTime(start + 1_000);
      oldB.close();
      vi.setSystemTime(start + 1_000 + gapMs);
      open('tab-b');
      return relay.getTransportDiagnostics().primaryTabId;
    }

    it('defaults to 5 000 ms: a reopen 4 999 ms after the end resumes the tab, one 5 000 ms after is a new tab', () => {
      expect(primaryAfterReopen(freshRelay(), 4_999)).toBe('tab-a');
      expect(primaryAfterReopen(freshRelay(), 5_000)).toBe('tab-b');
    });

    it('is read from UI_BRIDGE_RECONNECT_GRACE_MS', () => {
      process.env[KEY] = '2000';
      expect(primaryAfterReopen(freshRelay(), 1_999)).toBe('tab-a');
      expect(primaryAfterReopen(freshRelay(), 2_000)).toBe('tab-b');
    });

    it('takes an explicit option over the env var', () => {
      process.env[KEY] = '2000';
      expect(primaryAfterReopen(freshRelay({ reconnectGraceMs: 8_000 }), 7_999)).toBe('tab-a');
    });
  });
});
