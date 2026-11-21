/**
 * Reads served from the relay's snapshot cache say WHICH answer they are (plan
 * 2026-11-08-ui-bridge-relay-and-exec-mode-follow-ups-from-pr-329, Phase 5, D5).
 *
 * A reader refreshes the cache (`refreshSnapshotIfNeeded`, which now reports a
 * `RefreshOutcome`) and answers through one composition,
 * `answerFromSnapshotCache`:
 *
 *   - the tab ANSWERED the refresh with a failure: that failure, never the
 *     cached data;
 *   - no live answer (not delivered, a timeout): the cached data, `stale`, and
 *     `_meta.fallback` naming the cause;
 *   - a malformed snapshot (never cached, the 2026-10-01 design): the cached
 *     data, `stale`, and the fallback marker naming the malformed answer;
 *   - a fresh snapshot: the live data, `stale: false`, no marker;
 *   - `recency: 'any'`: the cache by request, no relay call, no marker.
 *
 * Driven as a table over the eight readers. `find` asks the tab first and the
 * fake tab never accepts it, so its cache answer is always marked with ITS
 * cause, whatever the refresh did. Expected reasons are spelled as literals.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';

const relays: CommandRelay[] = [];

afterEach(() => {
  for (const relay of relays.splice(0)) relay.destroy();
});

/** The fake tab's timeout budget for a silent answer, and the cache TTL. */
const SSE_TIMEOUT_MS = 500;
const CACHE_TTL_MS = 20;
/** A recency every non-`any` row asks for, so an aged cache is refreshed. */
const AGED = '10';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A snapshot whose every row says which one it is. */
function snapshot(which: 'cached' | 'live') {
  const elements = [
    { id: 'el-1', type: 'button', label: `Save ${which}`, actions: ['click'], state: {} },
    ...(which === 'live'
      ? [{ id: 'el-2', type: 'button', label: 'Other live', actions: ['click'], state: {} }]
      : []),
  ];
  return {
    timestamp: Date.now(),
    elements,
    components: [{ id: 'cmp-1', name: which, type: 'panel', actions: [] }],
    workflows: [{ id: 'wf-1', name: which, steps: [] }],
  };
}

const TAB_FAILURE = {
  success: false,
  error: 'The page registry threw while serializing',
  code: 'ELEMENT_NOT_FOUND',
};

type SnapMode = 'cached' | 'live' | 'reported' | 'unaccepted' | 'silent' | 'malformed';

/**
 * A tab that answers `getControlSnapshot` by `mode.current`, never accepts
 * `find` (so `find` always reaches its cache arm), and resolves `{}` to
 * anything else. `snapshots` counts the snapshot reads it was sent.
 */
function rig(userId?: string) {
  const relay = new CommandRelay({
    globalPrefix: `__uiBridgeSnapCache_${Math.random().toString(36).slice(2, 10)}`,
    sseTimeoutMs: SSE_TIMEOUT_MS,
  });
  relays.push(relay);
  const mode: { current: SnapMode } = { current: 'cached' };
  const counts = { snapshots: 0 };
  relay.subscribeToCommands((cmd) => {
    if (cmd.action === 'find' || cmd.action === 'getElement') {
      throw new Error('stream write failed');
    }
    if (cmd.action !== 'getControlSnapshot') {
      setTimeout(() => relay.resolveCommand(cmd.commandId, {}, 'tab-a'), 0);
      return;
    }
    counts.snapshots++;
    const m = mode.current;
    if (m === 'unaccepted') throw new Error('stream write failed');
    if (m === 'silent') return;
    setTimeout(() => {
      if (m === 'reported') {
        void relay.rejectCommand(cmd.commandId, TAB_FAILURE.error, 'tab-a', undefined, TAB_FAILURE);
        return;
      }
      relay.resolveCommand(
        cmd.commandId,
        m === 'malformed' ? { timestamp: Date.now() } : snapshot(m),
        'tab-a'
      );
    }, 0);
  }, 'tab-a');
  if (userId) relay.recordRegistration('tab-a', { userId, sessionId: `${userId}-session` });
  const handlers = createRelayHandlers(relay, { cacheTtlMs: CACHE_TTL_MS });
  return { relay, handlers, mode, counts };
}

type Handlers = ReturnType<typeof createRelayHandlers>;
type Reader = {
  name: string;
  read: (
    h: Handlers,
    recency: string
  ) => Promise<{ success: boolean; data?: unknown; _meta?: unknown }>;
  /** Which snapshot the answer came from. */
  which: (data: unknown) => 'cached' | 'live';
};

const byLabel = (label: string): 'cached' | 'live' => (label.endsWith('live') ? 'live' : 'cached');
const byName = (name: string): 'cached' | 'live' => (name === 'live' ? 'live' : 'cached');

const READERS: Reader[] = [
  {
    name: 'getElements',
    read: (h, recency) => h.getElements!({ recency } as never),
    which: (d) => byLabel((d as Array<{ label: string }>)[0].label),
  },
  {
    name: 'getComponents',
    read: (h, recency) => h.getComponents!({ recency } as never),
    which: (d) => byName((d as { components: Array<{ name: string }> }).components[0].name),
  },
  {
    name: 'getComponent',
    read: (h, recency) => h.getComponent!('cmp-1', { recency } as never),
    which: (d) => byName((d as { name: string }).name),
  },
  {
    name: 'getWorkflows',
    read: (h, recency) => h.getWorkflows!({ recency } as never),
    which: (d) => byName((d as Array<{ name: string }>)[0].name),
  },
  {
    name: 'rankElements',
    read: (h, recency) => h.rankElements!({ text: 'save', recency } as never),
    which: (d) => byLabel((d as Array<{ element: { label: string } }>)[0].element.label),
  },
  {
    name: 'find',
    read: (h, recency) => h.find!({ skipSettle: true, recency } as never),
    which: (d) => byLabel((d as { elements: Array<{ label: string }> }).elements[0].label),
  },
  {
    name: 'visibility',
    read: (h, recency) => h.visibility!({ recency }),
    which: (d) => ((d as { elementCount: number }).elementCount === 2 ? 'live' : 'cached'),
  },
  {
    name: 'getControlSnapshot',
    read: (h, recency) => h.getControlSnapshot!({ recency } as never),
    which: (d) => byLabel((d as { elements: Array<{ label: string }> }).elements[0].label),
  },
];

const NOT_DELIVERED = 'no browser tab is connected to receive it';
const TIMED_OUT = 'no tab answered it in time';
const MALFORMED = 'the tab answered a malformed control snapshot, which is never cached';

function reason(action: string, cause: string): string {
  return (
    `Relay command '${action}' got no live answer (${cause}) — answered from the cached ` +
    `snapshot, which can be stale or another tab's.`
  );
}

/** The marker `find`'s cache answer always carries: `find` itself was never accepted. */
const FIND_REASON = reason('find', NOT_DELIVERED);

/** Warm the cache with the `cached` snapshot, then age it past the TTL. */
async function warm(r: ReturnType<typeof rig>): Promise<void> {
  const warmed = await r.handlers.getControlSnapshot!({ recency: 'current' } as never);
  expect(warmed.success).toBe(true);
  await sleep(CACHE_TTL_MS * 2);
}

describe.each(READERS)('$name · served from the snapshot cache', (reader) => {
  const isFind = reader.name === 'find';

  it("the tab ANSWERS the refresh with a failure: that failure, with the tab's code — no cached data", async () => {
    const r = rig();
    await warm(r);
    r.mode.current = 'reported';
    const res = await reader.read(r.handlers, AGED);
    expect(res).toEqual({
      success: false,
      error: 'The page registry threw while serializing',
      code: 'ELEMENT_NOT_FOUND',
      data: TAB_FAILURE,
      timestamp: expect.any(Number),
    });
  });

  it('not delivered: the cached data, stale, marked with the cause', async () => {
    const r = rig();
    await warm(r);
    r.mode.current = 'unaccepted';
    const res = await reader.read(r.handlers, AGED);
    expect(res.success).toBe(true);
    expect(reader.which(res.data)).toBe('cached');
    expect(res._meta).toMatchObject({
      stale: true,
      fallback: true,
      reason: isFind ? FIND_REASON : reason('getControlSnapshot', NOT_DELIVERED),
    });
  });

  it('a timeout: the cached data, stale, marked with its own cause', async () => {
    const r = rig();
    await warm(r);
    r.mode.current = 'silent';
    const res = await reader.read(r.handlers, AGED);
    expect(res.success).toBe(true);
    expect(reader.which(res.data)).toBe('cached');
    expect(res._meta).toMatchObject({
      stale: true,
      fallback: true,
      reason: isFind ? FIND_REASON : reason('getControlSnapshot', TIMED_OUT),
    });
  });

  it('a malformed snapshot: the cached data, stale, marked as the malformed answer', async () => {
    const r = rig();
    await warm(r);
    r.mode.current = 'malformed';
    const res = await reader.read(r.handlers, AGED);
    expect(res.success).toBe(true);
    expect(reader.which(res.data)).toBe('cached');
    expect(res._meta).toMatchObject({
      stale: true,
      fallback: true,
      reason: isFind ? FIND_REASON : reason('getControlSnapshot', MALFORMED),
    });
  });

  it('a fresh snapshot: the live data, not stale, and no fallback marker', async () => {
    const r = rig();
    await warm(r);
    r.mode.current = 'live';
    const res = await reader.read(r.handlers, AGED);
    expect(res.success).toBe(true);
    expect(reader.which(res.data)).toBe('live');
    expect(res._meta).toMatchObject({ stale: false });
    if (isFind) {
      // `find` itself got no live answer: the answer is the cache's (fresh).
      expect(res._meta).toMatchObject({ fallback: true, reason: FIND_REASON });
    } else {
      expect((res._meta as { fallback?: unknown }).fallback).toBeUndefined();
      expect((res._meta as { reason?: unknown }).reason).toBeUndefined();
    }
  });

  it('no tab ever filled the cache, and no live answer: the failure, never an empty success', async () => {
    const r = rig();
    r.mode.current = 'unaccepted';
    const res = await reader.read(r.handlers, AGED);
    expect(res).toEqual({
      success: false,
      error:
        'No active UI Bridge SDK client received the getControlSnapshot command. ' +
        '1 SSE listener(s) registered but none accepted the command. ' +
        'Ensure the web app is open in a browser tab with the UI Bridge SDK loaded.',
      code: 'UB-ACTION-FAILED',
      timestamp: expect.any(Number),
    });
  });

  it('no tab ever filled the cache, and the tab answered a malformed snapshot: the malformed refusal', async () => {
    const r = rig();
    r.mode.current = 'malformed';
    const res = await reader.read(r.handlers, AGED);
    expect(res.success).toBe(false);
    expect((res as { error?: string }).error).toMatch(/malformed control snapshot/);
    expect(res.data).toBeUndefined();
  });

  it("recency 'any': the cache by request — no snapshot read, no fallback marker", async () => {
    const r = rig();
    await warm(r);
    r.mode.current = 'live';
    const before = r.counts.snapshots;
    const res = await reader.read(r.handlers, 'any');
    expect(res.success).toBe(true);
    expect(reader.which(res.data)).toBe('cached');
    expect(r.counts.snapshots).toBe(before);
    if (!isFind) {
      expect((res._meta as { fallback?: unknown }).fallback).toBeUndefined();
    }
  });
});

describe("getElement · unpinned · no live answer: the cache arm answers by the refresh's outcome", () => {
  it('the tab ANSWERS the refresh with a failure: that failure, not a cached not-found', async () => {
    const r = rig();
    await warm(r);
    r.mode.current = 'reported';
    expect(await r.handlers.getElement!('el-2')).toEqual({
      success: false,
      error: 'The page registry threw while serializing',
      code: 'ELEMENT_NOT_FOUND',
      data: TAB_FAILURE,
      timestamp: expect.any(Number),
    });
  });

  it('no tab ever filled the cache: the no-answer failure, not "not found in the cached snapshot"', async () => {
    const r = rig();
    r.mode.current = 'unaccepted';
    const res = await r.handlers.getElement!('el-1');
    expect(res.success).toBe(false);
    expect(res.error).toContain(
      'No active UI Bridge SDK client received the getControlSnapshot command.'
    );
  });

  it("a refreshed snapshot holding the id: the element, marked with getElement's cause", async () => {
    const r = rig();
    await warm(r);
    r.mode.current = 'live';
    const res = await r.handlers.getElement!('el-2');
    expect(res.success).toBe(true);
    expect((res.data as { label: string }).label).toBe('Other live');
    expect(res._meta).toEqual({
      fallback: true,
      reason: reason('getElement', NOT_DELIVERED),
    });
  });
});

describe('an owner-scoped caller reads its own snapshot cache', () => {
  it("no live answer: alice's cached data, marked; bob never sees it", async () => {
    const r = rig('alice');
    const warmed = await r.handlers.getControlSnapshot!({ recency: 'current' } as never, {
      callerUserId: 'alice',
    });
    expect(warmed.success).toBe(true);
    await sleep(CACHE_TTL_MS * 2);
    r.mode.current = 'unaccepted';

    const alice = await r.handlers.getElements!({ recency: AGED } as never, {
      callerUserId: 'alice',
    });
    expect(alice.success).toBe(true);
    expect((alice.data as Array<{ label: string }>)[0].label).toBe('Save cached');
    expect(alice._meta).toMatchObject({
      stale: true,
      fallback: true,
      reason: reason('getControlSnapshot', NOT_DELIVERED),
    });

    const bob = await r.handlers.getElements!({ recency: AGED } as never, {
      callerUserId: 'bob',
    });
    expect(bob.success).toBe(false);
    expect(JSON.stringify(bob)).not.toContain('Save cached');
  });

  it("a refresh alice's tab answered with a failure: that failure, never alice's cached data", async () => {
    const r = rig('alice');
    await r.handlers.getControlSnapshot!({ recency: 'current' } as never, {
      callerUserId: 'alice',
    });
    await sleep(CACHE_TTL_MS * 2);
    r.mode.current = 'reported';
    const res = await r.handlers.getComponents!({ recency: AGED } as never, {
      callerUserId: 'alice',
    });
    expect(res).toMatchObject({ success: false, code: 'ELEMENT_NOT_FOUND', data: TAB_FAILURE });
  });
});

describe('refreshSnapshotIfNeeded · concurrent readers share one refresh and its outcome', () => {
  it('two readers, one snapshot read, the same marked answer', async () => {
    const r = rig();
    await warm(r);
    r.mode.current = 'unaccepted';
    const before = r.counts.snapshots;
    const [a, b] = await Promise.all([
      r.handlers.getElements!({ recency: AGED } as never),
      r.handlers.getWorkflows!({ recency: AGED } as never),
    ]);
    expect(r.counts.snapshots - before).toBe(1);
    for (const res of [a, b]) {
      expect(res._meta).toMatchObject({
        stale: true,
        fallback: true,
        reason: reason('getControlSnapshot', NOT_DELIVERED),
      });
    }
  });

  it('two readers sharing a refresh the tab answered with a failure both answer that failure', async () => {
    const r = rig();
    await warm(r);
    r.mode.current = 'reported';
    const before = r.counts.snapshots;
    const [a, b] = await Promise.all([
      r.handlers.getComponents!({ recency: AGED } as never),
      r.handlers.getElements!({ recency: AGED } as never),
    ]);
    expect(r.counts.snapshots - before).toBe(1);
    for (const res of [a, b]) {
      expect(res).toMatchObject({ success: false, code: 'ELEMENT_NOT_FOUND', data: TAB_FAILURE });
    }
  });
});

describe('pageHealth · a refresh the tab answered with a failure', () => {
  it('over an EMPTY cache: unknown{producer_failed} naming the failure — the tab was reached, so not app_unreachable', async () => {
    const r = rig();
    r.mode.current = 'reported';
    const res = await r.handlers.pageHealth!();
    expect(res.success).toBe(true);
    const data = res.data as { status: string; unknown?: { code: string; detail?: string } };
    expect(data.status).toBe('unknown');
    expect(data.unknown?.code).toBe('producer_failed');
    expect(JSON.stringify(data)).toContain(
      'the browser tab answered the snapshot read with a failure (The page registry threw while serializing) and the relay holds none cached'
    );
  });

  it('over a POPULATED cache: unknown{stale_input} whose detail names the live failure', async () => {
    const r = rig();
    await warm(r);
    r.mode.current = 'reported';
    const res = await r.handlers.pageHealth!();
    expect(res.success).toBe(true);
    const data = res.data as { status: string; unknown?: { code: string } };
    expect(data.status).toBe('unknown');
    expect(data.unknown?.code).toBe('stale_input');
    expect(JSON.stringify(data)).toContain(
      'the browser tab answered the snapshot read with a failure (The page registry threw while serializing); the cached snapshot is stale'
    );
  });

  it('no live answer over an empty cache stays unknown{app_unreachable}', async () => {
    const r = rig();
    r.mode.current = 'unaccepted';
    const res = await r.handlers.pageHealth!();
    expect((res.data as { unknown?: { code: string } }).unknown?.code).toBe('app_unreachable');
  });
});
