/**
 * The relay's two time thresholds, and the fact that they are two.
 *
 * It used to have three, two of which were near-anagrams of each other:
 *
 *   heartbeatStaleMs  (30s, no env)  -> isAppResponsive(), primary re-promotion
 *   staleHeartbeatMs  (30s, env)     -> getActiveTabs(), isTabActive(), wire
 *   zombieTransportMs (300s, env)    -> the destructive prune
 *
 * The first two were one concept — "did this tab beat recently?" — carrying
 * two names, two independent defaults, and only one env override, so setting
 * the documented knob moved half the behaviour and silently left the other
 * half at its hardcoded default. They are now a single `tabActiveWindowMs`.
 *
 * These tests pin the merge (one option reaches EVERY freshness caller) and
 * the separation (freshness and the destructive prune stay independent). A
 * rename alone would pass without them: renaming two fields to the same name
 * compiles and leaves every existing test green, because no existing test ever
 * set the two to different values.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { CommandRelay } from './command-relay';

function freshRelay(
  options?: Partial<ConstructorParameters<typeof CommandRelay>[0]>
): CommandRelay {
  const prefix = `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`;
  return new CommandRelay({ globalPrefix: prefix, ...(options ?? {}) });
}

describe('relay · tabActiveWindowMs reaches every freshness caller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('governs isAppResponsive — the /health `responsive` bit', () => {
    // Pre-merge this caller read `heartbeatStaleMs`, which had NO env override
    // and could not be reached by the documented option at all. A 5s window
    // with a 10s-old beat must read false.
    const relay = freshRelay({ tabActiveWindowMs: 5_000 });
    relay.subscribeToCommands(() => {}, 'tab-a');
    relay.receiveHeartbeat('tab-a');

    expect(relay.isAppResponsive()).toBe(true);

    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));
    expect(relay.isAppResponsive()).toBe(false);
  });

  it('governs getActiveTabs and isTabActive', () => {
    const relay = freshRelay({ tabActiveWindowMs: 5_000 });
    relay.subscribeToCommands(() => {}, 'tab-a');
    relay.receiveHeartbeat('tab-a');

    expect(relay.getActiveTabs()).toContain('tab-a');
    expect(relay.isTabActive('tab-a')).toBe(true);

    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));
    expect(relay.getActiveTabs()).not.toContain('tab-a');
    expect(relay.isTabActive('tab-a')).toBe(false);
  });

  it('moves both callers together — the defect the split names allowed', () => {
    // The bug the merge closes: one window, so a caller cannot be left behind
    // on a different default. Both must flip at the SAME instant.
    const relay = freshRelay({ tabActiveWindowMs: 5_000 });
    relay.subscribeToCommands(() => {}, 'tab-a');
    relay.receiveHeartbeat('tab-a');

    vi.setSystemTime(new Date('2026-01-01T00:00:04Z'));
    expect(relay.isAppResponsive()).toBe(true);
    expect(relay.isTabActive('tab-a')).toBe(true);

    vi.setSystemTime(new Date('2026-01-01T00:00:06Z'));
    expect(relay.isAppResponsive()).toBe(false);
    expect(relay.isTabActive('tab-a')).toBe(false);
  });

  it('is surfaced on the diagnostics payload under its own name', () => {
    const relay = freshRelay({ tabActiveWindowMs: 7_000 });
    const diag = relay.getTransportDiagnostics();

    expect(diag.tabActiveWindowMs).toBe(7_000);
    // The old name is gone from the wire, not aliased.
    expect((diag as Record<string, unknown>).staleHeartbeatMs).toBeUndefined();
    expect((diag as Record<string, unknown>).heartbeatStaleMs).toBeUndefined();
  });
});

describe('relay · the freshness window and the destructive prune stay independent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a tab can be inactive for a long time without being pruned', () => {
    // This is the normal steady state of a backgrounded tab: outside the
    // freshness window for most of every minute, transport working throughout.
    const relay = freshRelay({ tabActiveWindowMs: 5_000, zombieTransportMs: 300_000 });
    relay.subscribeToCommands(() => {}, 'tab-hidden');
    relay.receiveHeartbeat('tab-hidden');

    vi.setSystemTime(new Date('2026-01-01T00:01:00Z')); // +60s

    expect(relay.isTabActive('tab-hidden')).toBe(false); // stale...
    expect(relay.pruneStaleTabs()).toEqual([]); // ...but not disconnected
    expect(relay.getConnectedTabs()).toContain('tab-hidden');
    // And still counted as a reachable command transport.
    expect(relay.getTransportDiagnostics().commandListenerCount).toBe(1);
  });

  it('reports the two thresholds separately so neither can be mistaken for the other', () => {
    const relay = freshRelay({ tabActiveWindowMs: 5_000, zombieTransportMs: 300_000 });
    const diag = relay.getTransportDiagnostics();

    expect(diag.tabActiveWindowMs).toBe(5_000);
    expect(diag.zombieTransportMs).toBe(300_000);
    expect(diag.tabActiveWindowMs).not.toBe(diag.zombieTransportMs);
  });
});

describe('relay · env override', () => {
  const KEY = 'UI_BRIDGE_TAB_ACTIVE_WINDOW_MS';
  const original = process.env[KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('reads the window from UI_BRIDGE_TAB_ACTIVE_WINDOW_MS', () => {
    process.env[KEY] = '12345';
    expect(freshRelay().getTransportDiagnostics().tabActiveWindowMs).toBe(12_345);
  });

  it('lets an explicit option win over the env var', () => {
    process.env[KEY] = '12345';
    expect(freshRelay({ tabActiveWindowMs: 999 }).getTransportDiagnostics().tabActiveWindowMs).toBe(
      999
    );
  });
});
