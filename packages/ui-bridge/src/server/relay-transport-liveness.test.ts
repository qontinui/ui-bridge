/**
 * Regression tests — command-transport liveness vs. heartbeat freshness.
 *
 * Measured incident (qontinui-web, 2026-09-04/05): the relay accepted reads
 * and reported `commandListenerCount: 1`, but every
 * `POST /control/element/:id/action` failed with `SDK_DISCONNECTED`, on a
 * repeating ~60s cycle. The dev-server log showed 916 `tab.pruned` events for
 * a single tab, each with `age_ms` between 30_000 and 37_000 against
 * `staleHeartbeatMs: 30000`, and each followed immediately by the tab's SSE
 * stream disconnecting and reconnecting.
 *
 * Root cause: the client heartbeat is a `setInterval` (10s requested), and the
 * tab was backgrounded (`visibility: "hidden"` in its own snapshot). Chrome's
 * intensive throttling clamps background timers to ~1 firing per minute, so
 * the beat arrived every ~60s while `pruneStaleTabs()` destroyed the tab's
 * transport at 30s. The SSE command stream was OPEN the whole time — the
 * relay tore down a working transport because a throttled proxy signal had
 * aged out.
 *
 * These tests pin the two properties that incident violated:
 *   1. A tab whose command transport is open is not disconnected merely
 *      because its (throttleable) heartbeat is stale.
 *   2. `commandListenerCount` counts open command transports, so it cannot
 *      report a listener that dispatch would not find.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';
import { createNextRouteHandlers } from './nextjs';
import { parseSSEDataBlock } from '../relay/relay-client';

function freshRelay(
  options?: Partial<ConstructorParameters<typeof CommandRelay>[0]>
): CommandRelay {
  const prefix = `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`;
  return new CommandRelay({ globalPrefix: prefix, ...(options ?? {}) });
}

describe('relay · a throttled heartbeat must not destroy a live command transport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the SSE listener of a hidden tab beating at the ~60s throttled cadence', () => {
    // Defaults on purpose: staleHeartbeatMs 30s, zombieTransportMs 5min.
    const relay = freshRelay();
    relay.subscribeToCommands(() => {}, 'tab-hidden');
    relay.receiveHeartbeat('tab-hidden');

    // +45s: past staleHeartbeatMs (30s), which is the whole point — a
    // background-throttled tab is ALWAYS in this window between beats.
    vi.setSystemTime(new Date('2026-01-01T00:00:45Z'));

    const pruned = relay.pruneStaleTabs();

    expect(pruned).toEqual([]);
    expect(relay.getConnectedTabs()).toContain('tab-hidden');
    // Staleness is still reported — non-destructively.
    expect(relay.getActiveTabs()).not.toContain('tab-hidden');
  });

  it('still delivers a command over that stale-heartbeat-but-open transport', async () => {
    const relay = freshRelay();
    const delivered: string[] = [];
    relay.subscribeToCommands((cmd) => {
      delivered.push(cmd.action);
      // Settle so queueCommand resolves rather than timing out.
      relay.resolveCommand(cmd.commandId, { ok: true }, 'tab-hidden');
    }, 'tab-hidden');
    relay.receiveHeartbeat('tab-hidden');

    vi.setSystemTime(new Date('2026-01-01T00:00:45Z'));
    relay.pruneStaleTabs();

    // The incident's exact call shape: an untargeted element action.
    const result = relay.queueCommand('executeElementAction', {
      elementId: 'doc-history-policy-ux-priorities',
      action: 'click',
    });
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toMatchObject({ ok: true });
    expect(delivered).toEqual(['executeElementAction']);
  });

  it('survives many throttled beat/sweep cycles (the 916-prune loop)', () => {
    const relay = freshRelay();
    relay.subscribeToCommands(() => {}, 'tab-hidden');

    let t = 0;
    for (let cycle = 0; cycle < 20; cycle++) {
      relay.receiveHeartbeat('tab-hidden');
      // Sweep repeatedly across a full throttled 60s gap.
      for (let step = 0; step < 6; step++) {
        t += 10_000;
        vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + t));
        relay.pruneStaleTabs();
      }
    }

    expect(relay.getConnectedTabs()).toContain('tab-hidden');
  });

  it('still prunes a genuinely frozen tab once past zombieTransportMs', () => {
    const relay = freshRelay({ zombieTransportMs: 300_000 });
    relay.subscribeToCommands(() => {}, 'tab-frozen');
    relay.receiveHeartbeat('tab-frozen');

    // +6min — beyond any browser throttling clamp. This tab is not throttled,
    // it is gone.
    vi.setSystemTime(new Date('2026-01-01T00:06:00Z'));

    expect(relay.pruneStaleTabs()).toEqual(['tab-frozen']);
    expect(relay.getConnectedTabs()).not.toContain('tab-frozen');
  });

  it('prunes at zombieTransportMs, not at staleHeartbeatMs', () => {
    // Pins WHICH threshold governs the destructive path. Without this the
    // two could be silently re-coupled and every test above still passes
    // by virtue of the default 5min being large.
    const relay = freshRelay({ staleHeartbeatMs: 5_000, zombieTransportMs: 60_000 });
    relay.subscribeToCommands(() => {}, 'tab-a');
    relay.receiveHeartbeat('tab-a');

    // Well past staleHeartbeatMs, well short of zombieTransportMs.
    vi.setSystemTime(new Date('2026-01-01T00:00:30Z'));
    expect(relay.pruneStaleTabs()).toEqual([]);

    // Past zombieTransportMs.
    vi.setSystemTime(new Date('2026-01-01T00:01:30Z'));
    expect(relay.pruneStaleTabs()).toEqual(['tab-a']);
  });
});

describe('relay · commandListenerCount observes open command transports', () => {
  it('counts a WebSocket-only tab, which has a working command transport', () => {
    const relay = freshRelay();
    relay.registerWebSocketClient({
      clientId: 'tab-ws',
      send: () => {},
      isConnected: () => true,
      close: () => {},
    });

    const diag = relay.getTransportDiagnostics();

    // Pre-fix this read 0 (`tabListeners.size`), i.e. the field reported
    // "no command listener" for a tab that could receive commands.
    expect(diag.wsClientCount).toBe(1);
    expect(diag.commandListenerCount).toBe(1);
  });

  it('counts a tab reachable over both SSE and WS exactly once', () => {
    const relay = freshRelay();
    relay.subscribeToCommands(() => {}, 'tab-both');
    relay.registerWebSocketClient({
      clientId: 'tab-both',
      send: () => {},
      isConnected: () => true,
      close: () => {},
    });

    expect(relay.getTransportDiagnostics().commandListenerCount).toBe(1);
  });

  it('counts SSE and WS tabs together', () => {
    const relay = freshRelay();
    relay.subscribeToCommands(() => {}, 'tab-sse');
    relay.registerWebSocketClient({
      clientId: 'tab-ws',
      send: () => {},
      isConnected: () => true,
      close: () => {},
    });

    expect(relay.getTransportDiagnostics().commandListenerCount).toBe(2);
  });

  it('reports zero exactly when dispatch would answer SDK_DISCONNECTED', () => {
    const relay = freshRelay();
    expect(relay.getTransportDiagnostics().commandListenerCount).toBe(0);
  });

  it('discloses both thresholds so a reader can tell which governs a disconnect', () => {
    const relay = freshRelay({ staleHeartbeatMs: 30_000, zombieTransportMs: 300_000 });
    const diag = relay.getTransportDiagnostics();

    expect(diag.staleHeartbeatMs).toBe(30_000);
    expect(diag.zombieTransportMs).toBe(300_000);
  });
});

describe('relay · the command stream emits a client-actionable keep-alive', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a named `ping` event with a data payload, not a bare comment', async () => {
    // The client cannot hold its own cadence in a hidden tab (setInterval is
    // clamped to ~1/min), so the keep-alive has to be something it can act
    // on. A bare `: heartbeat` comment is invisible to the SSE data parser.
    const relay = freshRelay();
    const handlers = createRelayHandlers(relay);
    const route = createNextRouteHandlers(handlers, { relay });

    const url = new URL('http://localhost/api/ui-bridge/commands/stream?tabId=tab-a');
    const req = new Request(url.toString(), { method: 'GET' }) as unknown as Request & {
      nextUrl: URL;
    };
    req.nextUrl = url;

    const response = await route.GET(
      req as never,
      {
        params: { path: ['commands', 'stream'] },
      } as never
    );

    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();

    // The stream opens with a `connected` handshake and may also carry a
    // proactive snapshot command, so read forward until the keep-alive.
    let keepAlive: string | null = null;
    for (let i = 0; i < 6 && keepAlive === null; i++) {
      await vi.advanceTimersByTimeAsync(15_000);
      const frame = decoder.decode((await reader.read()).value);
      if (frame.includes('ping')) keepAlive = frame;
    }

    expect(keepAlive).not.toBeNull();
    expect(keepAlive!).toContain('event: ping');
    const data = parseSSEDataBlock(keepAlive!.replace(/\n\n$/, ''));
    expect(data).not.toBeNull();
    expect(JSON.parse(data!).type).toBe('ping');

    await reader.cancel();
  });
});
