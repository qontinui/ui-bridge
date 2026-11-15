/**
 * Tab liveness — the ordering the relay's selectors rank candidate tabs by
 * when a command names no tab (plan
 * 2026-11-09-a-dead-relay-tab-stays-the-operators-primary-and-a-command-sent-during-a-stream-reopen-is-lost,
 * D5). The relay-level behaviour it drives is pinned in
 * `relay-per-tab-routing.test.ts` ("Phase 3"); these are the predicate and
 * the comparator on their own, over hand-built sources.
 */

import { describe, expect, it } from 'vitest';
import {
  compareByLiveness,
  heartbeatAgeMs,
  isTabLive,
  keepsPrimary,
  takeFreshnessSnapshot,
  type LivenessSources,
} from './tab-liveness';

const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);
const WINDOW_MS = 30_000;

/** One tab's transports and history, as offsets from T0 in ms. */
interface TabSpec {
  /** An SSE listener that registered at this offset. */
  sse?: number;
  /** A WebSocket client that registered at `at`. */
  ws?: { at: number; connected: boolean };
  /** This instance's last heartbeat from the tab. */
  beat?: number;
  /** The last command the tab answered successfully. */
  success?: number;
}

function sourcesOf(tabs: Record<string, TabSpec>): LivenessSources {
  const listeners = new Map<string, { openedAt: number }>();
  const wsClients = new Map<string, { connectedAt: number; client: { isConnected(): boolean } }>();
  const heartbeats = new Map<string, number>();
  const lastSuccess = new Map<string, number>();
  for (const [tabId, spec] of Object.entries(tabs)) {
    if (spec.sse !== undefined) listeners.set(tabId, { openedAt: T0 + spec.sse });
    const ws = spec.ws;
    if (ws) {
      wsClients.set(tabId, {
        connectedAt: T0 + ws.at,
        client: { isConnected: () => ws.connected },
      });
    }
    if (spec.beat !== undefined) heartbeats.set(tabId, T0 + spec.beat);
    if (spec.success !== undefined) lastSuccess.set(tabId, T0 + spec.success);
  }
  return { listeners, wsClients, heartbeats, lastSuccess };
}

/** A snapshot of every tab in `tabs`, taken `nowMs` after T0. */
function snapshotAt(nowMs: number, tabs: Record<string, TabSpec>) {
  return takeFreshnessSnapshot(Object.keys(tabs), sourcesOf(tabs), {
    now: T0 + nowMs,
    activeWindowMs: WINDOW_MS,
  });
}

describe('heartbeatAgeMs', () => {
  it('is the time since this instance last received the tab’s heartbeat', () => {
    const snapshot = snapshotAt(12_000, { 'tab-a': { sse: 0, beat: 5_000 } });
    expect(heartbeatAgeMs(snapshot, 'tab-a')).toBe(7_000);
  });

  it('is undefined for a tab that never beat here, and for a tab outside the snapshot', () => {
    const snapshot = snapshotAt(12_000, { 'tab-a': { sse: 0 } });
    expect(heartbeatAgeMs(snapshot, 'tab-a')).toBeUndefined();
    expect(heartbeatAgeMs(snapshot, 'tab-unknown')).toBeUndefined();
  });
});

describe('isTabLive', () => {
  it('holds while the heartbeat is within the window, through its last millisecond', () => {
    const tabs = { 'tab-a': { sse: 0, beat: 0 } };
    expect(isTabLive(snapshotAt(30_000, tabs), 'tab-a')).toBe(true);
    expect(isTabLive(snapshotAt(30_001, tabs), 'tab-a')).toBe(false);
  });

  it('8 · a tab that never beat here is live only while its stream is within the window: 31 s old is not live', () => {
    const tabs = { 'tab-a': { sse: 0 } };
    expect(isTabLive(snapshotAt(29_000, tabs), 'tab-a')).toBe(true);
    expect(isTabLive(snapshotAt(30_000, tabs), 'tab-a')).toBe(true);
    expect(isTabLive(snapshotAt(31_000, tabs), 'tab-a')).toBe(false);
  });

  it('judges a tab that has beaten by its beat, not by a stream it opened since', () => {
    // A stream reopened 1 s ago does not stand in for a heartbeat 41 s old.
    const tabs = { 'tab-a': { sse: 40_000, beat: 0 } };
    expect(isTabLive(snapshotAt(41_000, tabs), 'tab-a')).toBe(false);
  });

  it('never holds for a tab with no open transport, however fresh its heartbeat', () => {
    const tabs = {
      'tab-closed-ws': { ws: { at: 0, connected: false }, beat: 1_000 },
      'tab-heartbeat-only': { beat: 1_000 },
    };
    const snapshot = snapshotAt(1_000, tabs);
    expect(isTabLive(snapshot, 'tab-closed-ws')).toBe(false);
    expect(isTabLive(snapshot, 'tab-heartbeat-only')).toBe(false);
    expect(isTabLive(snapshot, 'tab-unknown')).toBe(false);
  });

  it('counts a connected WebSocket client as an open transport', () => {
    const snapshot = snapshotAt(1_000, { 'tab-ws': { ws: { at: 0, connected: true } } });
    expect(isTabLive(snapshot, 'tab-ws')).toBe(true);
  });
});

describe('takeFreshnessSnapshot', () => {
  it('dates a tab’s warm-up from its youngest open transport', () => {
    // SSE opened at 0, a WebSocket client at 20 s: at 45 s the tab never beat,
    // and its youngest transport is 25 s old.
    const tabs = { 'tab-a': { sse: 0, ws: { at: 20_000, connected: true } } };
    const snapshot = snapshotAt(45_000, tabs);
    expect(snapshot.tabs.get('tab-a')).toEqual({ open: true, openedAt: T0 + 20_000 });
    expect(isTabLive(snapshot, 'tab-a')).toBe(true);
  });

  it('records each tab once, with the instant and window it was taken under', () => {
    const snapshot = takeFreshnessSnapshot(
      ['tab-a', 'tab-a'],
      sourcesOf({ 'tab-a': { sse: 0, beat: 1_000, success: 2_000 } }),
      { now: T0 + 3_000, activeWindowMs: 5_000 }
    );
    expect(snapshot.takenAt).toBe(T0 + 3_000);
    expect(snapshot.activeWindowMs).toBe(5_000);
    expect([...snapshot.tabs.entries()]).toEqual([
      ['tab-a', { open: true, openedAt: T0, lastBeatAt: T0 + 1_000, lastSuccessAt: T0 + 2_000 }],
    ]);
  });
});

describe('keepsPrimary', () => {
  const candidates = ['tab-primary', 'tab-other'];

  it('keeps a live primary, even when another candidate answered more recently', () => {
    const snapshot = snapshotAt(10_000, {
      'tab-primary': { sse: 0, beat: 5_000 },
      'tab-other': { sse: 0, beat: 9_000, success: 9_500 },
    });
    expect(keepsPrimary(snapshot, 'tab-primary', candidates)).toBe(true);
  });

  it('drops a primary that is not live while another candidate is', () => {
    const snapshot = snapshotAt(31_000, {
      'tab-primary': { sse: 0, beat: 0, success: 30_000 },
      'tab-other': { sse: 0, beat: 30_000 },
    });
    expect(keepsPrimary(snapshot, 'tab-primary', candidates)).toBe(false);
  });

  it('keeps a primary that is not live when no other candidate is live either', () => {
    const snapshot = snapshotAt(60_000, {
      'tab-primary': { sse: 0, beat: 0 },
      'tab-other': { sse: 0, beat: 1_000 },
    });
    expect(keepsPrimary(snapshot, 'tab-primary', candidates)).toBe(true);
    expect(keepsPrimary(snapshot, 'tab-primary', ['tab-primary'])).toBe(true);
  });
});

describe('compareByLiveness', () => {
  /** `ids` sorted best first under one snapshot taken `nowMs` after T0. */
  function ranked(nowMs: number, tabs: Record<string, TabSpec>, ids = Object.keys(tabs)) {
    return [...ids].sort(compareByLiveness(snapshotAt(nowMs, tabs)));
  }

  it('ranks a live tab before a not-live one, whatever their command successes', () => {
    const tabs = {
      // Answered the last command, then stopped beating: the measured dead primary.
      'tab-dead': { sse: 0, beat: 0, success: 29_000 },
      'tab-live': { sse: 0, beat: 30_000 },
    };
    expect(ranked(31_000, tabs)).toEqual(['tab-live', 'tab-dead']);
  });

  it('ranks live tabs by their most recent command success before their heartbeat', () => {
    const tabs = {
      'tab-beat-last': { sse: 0, beat: 20_000, success: 1_000 },
      'tab-answered-last': { sse: 0, beat: 10_000, success: 2_000 },
    };
    expect(ranked(21_000, tabs)).toEqual(['tab-answered-last', 'tab-beat-last']);
  });

  it('ranks tabs with equal successes by their most recent heartbeat, one that never beat last', () => {
    const tabs = {
      'tab-never-beat': { sse: 15_000 },
      'tab-older-beat': { sse: 0, beat: 10_000 },
      'tab-newer-beat': { sse: 0, beat: 20_000 },
    };
    expect(ranked(21_000, tabs)).toEqual(['tab-newer-beat', 'tab-older-beat', 'tab-never-beat']);
  });

  it('ranks not-live tabs among themselves by the same success-then-heartbeat order', () => {
    const tabs = {
      'tab-stale-older': { sse: 0, beat: 1_000 },
      'tab-stale-answered': { sse: 0, beat: 0, success: 500 },
      'tab-stale-newer': { sse: 0, beat: 2_000 },
    };
    expect(ranked(60_000, tabs)).toEqual([
      'tab-stale-answered',
      'tab-stale-newer',
      'tab-stale-older',
    ]);
  });

  it('keeps the input order of tabs it cannot tell apart', () => {
    const tabs = { 'tab-x': { sse: 0, beat: 0 }, 'tab-y': { sse: 0, beat: 0 } };
    expect(ranked(1_000, tabs, ['tab-y', 'tab-x'])).toEqual(['tab-y', 'tab-x']);
    expect(ranked(1_000, tabs, ['tab-x', 'tab-y'])).toEqual(['tab-x', 'tab-y']);
  });
});
