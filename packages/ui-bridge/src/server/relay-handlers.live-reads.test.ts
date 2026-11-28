/**
 * Relay reads that ASK THE TAB answer by one rule (plan
 * 2026-11-08-ui-bridge-relay-and-exec-mode-follow-ups-from-pr-329, Phase 4,
 * D5 and D6):
 *
 *   - a live answer is the answer: a success, the tab's resolved inner failure,
 *     or the failure a tab REPORTED (`TabReportedFailure`, its payload under
 *     `data`) — never overruled by a cache;
 *   - the cache answers only when there was NO live answer, marked
 *     `_meta.fallback` with the cause;
 *   - no live answer and no cache is a failure, never an empty success.
 *
 * `clearRenderLog` is a write, and answers its EFFECT (D6): a success only when
 * a tab confirmed the clear.
 *
 * Each reader is driven through a fake tab whose answer to the read is set per
 * case: `ok` (resolves), `inner` (resolves `{ success: false, … }`), `reported`
 * (the in-page relay client's `success: false` post: `rejectCommand` with the
 * posted envelope) and `unaccepted` (its listener throws, so the relay counts
 * zero deliveries and raises `NoLiveAnswer('not_delivered')`). Expected
 * envelopes are spelled as literals.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';
import type { RenderLogEntry } from '../render-log';

const relays: CommandRelay[] = [];

function freshRelay(): CommandRelay {
  const prefix = `__uiBridgeLiveReads_${Math.random().toString(36).slice(2, 10)}`;
  const relay = new CommandRelay({ globalPrefix: prefix });
  relays.push(relay);
  return relay;
}

afterEach(() => {
  for (const relay of relays.splice(0)) relay.destroy();
});

type Mode =
  | { kind: 'ok'; value: unknown }
  | { kind: 'inner' }
  | { kind: 'reported' }
  | { kind: 'unaccepted' };

/** What the tab posts for a failure, the dispatcher's envelope with a handler code. */
const TAB_FAILURE = {
  success: false,
  error: 'Browser capture is not installed in this page',
  code: 'ELEMENT_NOT_FOUND',
};

/** The envelope every live failure answers: the tab's code, its payload verbatim. */
const LIVE_FAILURE_ENVELOPE = {
  success: false,
  error: 'Browser capture is not installed in this page',
  code: 'ELEMENT_NOT_FOUND',
  data: TAB_FAILURE,
  timestamp: expect.any(Number),
};

/** The relay's no-live-answer failure for `action` (no tab accepted it), as the caller sees it. */
function noAnswerFailure(action: string) {
  return {
    success: false,
    error:
      `No active UI Bridge SDK client received the ${action} command. ` +
      '1 SSE listener(s) registered but none accepted the command. ' +
      'Ensure the web app is open in a browser tab with the UI Bridge SDK loaded.',
    code: 'UB-ACTION-FAILED',
    timestamp: expect.any(Number),
  };
}

/** The `_meta.reason` of a cache answer after no live answer (no tab accepted it). */
function fallbackReason(action: string, answeredFrom: string): string {
  return (
    `Relay command '${action}' got no live answer (no browser tab is connected to receive it) — ` +
    `answered from ${answeredFrom}, which can be stale or another tab's.`
  );
}

/**
 * A tab whose answer to `action` follows `mode.current`; every other action is
 * answered by `others` (resolves `{}` by default). Owned by `userId` when given.
 */
function tab(
  relay: CommandRelay,
  tabId: string,
  action: string,
  initial: Mode,
  userId?: string,
  others: Mode = { kind: 'ok', value: {} }
): { mode: { current: Mode }; seen: string[] } {
  const mode = { current: initial };
  const seen: string[] = [];
  relay.subscribeToCommands((cmd) => {
    seen.push(cmd.action);
    const m = cmd.action === action ? mode.current : others;
    if (m.kind === 'unaccepted') throw new Error('stream write failed');
    setTimeout(() => {
      if (m.kind === 'reported') {
        void relay.rejectCommand(cmd.commandId, TAB_FAILURE.error, tabId, undefined, TAB_FAILURE);
        return;
      }
      relay.resolveCommand(cmd.commandId, m.kind === 'inner' ? TAB_FAILURE : m.value, tabId);
    }, 0);
  }, tabId);
  if (userId) relay.recordRegistration(tabId, { userId, sessionId: `${userId}-session` });
  return { mode, seen };
}

// ============================================================================
// getConsoleErrors
// ============================================================================

const ERRORS = {
  errors: [{ id: 1, level: 'error', message: 'TypeError: x is undefined', timestamp: 1 }],
  count: 1,
};
const GROUPED = { groups: [{ fingerprint: 'f', count: 2 }], totalErrors: 2, totalGroups: 1 };

describe('relay getConsoleErrors · a live answer is the answer', () => {
  it('a live success answers the errors, unmarked', async () => {
    const relay = freshRelay();
    tab(relay, 'tab-a', 'getConsoleErrors', { kind: 'ok', value: ERRORS });
    const handlers = createRelayHandlers(relay);
    expect(await handlers.getConsoleErrors!({} as never)).toEqual({
      success: true,
      data: ERRORS,
      timestamp: expect.any(Number),
    });
  });

  it.each([['reported'], ['inner']] as const)(
    'a live failure (%s) beside a warm cache is that failure, never the cached errors',
    async (kind) => {
      const relay = freshRelay();
      const { mode } = tab(relay, 'tab-a', 'getConsoleErrors', { kind: 'ok', value: ERRORS });
      const handlers = createRelayHandlers(relay);
      await handlers.getConsoleErrors!({} as never);
      mode.current = { kind };
      expect(await handlers.getConsoleErrors!({} as never)).toEqual(LIVE_FAILURE_ENVELOPE);
    }
  );

  it('no live answer with a cache: the cached DATA, marked as the cache with its age', async () => {
    const relay = freshRelay();
    const { mode } = tab(relay, 'tab-a', 'getConsoleErrors', { kind: 'ok', value: ERRORS });
    const handlers = createRelayHandlers(relay);
    await handlers.getConsoleErrors!({} as never);
    mode.current = { kind: 'unaccepted' };
    expect(await handlers.getConsoleErrors!({} as never)).toEqual({
      success: true,
      data: ERRORS,
      timestamp: expect.any(Number),
      _meta: {
        fallback: true,
        reason: fallbackReason('getConsoleErrors', 'the last console-errors read'),
        cacheAgeMs: expect.any(Number),
      },
    });
  });

  it('no live answer and no cache: the failure, never { errors: [], count: 0 }', async () => {
    const relay = freshRelay();
    tab(relay, 'tab-a', 'getConsoleErrors', { kind: 'unaccepted' });
    const handlers = createRelayHandlers(relay);
    expect(await handlers.getConsoleErrors!({} as never)).toEqual(
      noAnswerFailure('getConsoleErrors')
    );
  });

  it('grouped: a live success answers the groups', async () => {
    const relay = freshRelay();
    tab(relay, 'tab-a', 'getConsoleErrors', { kind: 'ok', value: GROUPED });
    const handlers = createRelayHandlers(relay);
    expect(await handlers.getConsoleErrors!({ group: true } as never)).toEqual({
      success: true,
      data: GROUPED,
      timestamp: expect.any(Number),
    });
  });

  it('grouped: no live answer is the failure, never { groups: [] }, even beside an ungrouped cache', async () => {
    const relay = freshRelay();
    const { mode } = tab(relay, 'tab-a', 'getConsoleErrors', { kind: 'ok', value: ERRORS });
    const handlers = createRelayHandlers(relay);
    await handlers.getConsoleErrors!({} as never);
    mode.current = { kind: 'unaccepted' };
    expect(await handlers.getConsoleErrors!({ group: true } as never)).toEqual(
      noAnswerFailure('getConsoleErrors')
    );
  });

  it("scoped: no live answer answers the caller's own cache, marked; another caller's is never served", async () => {
    const relay = freshRelay();
    const { mode } = tab(
      relay,
      'tab-a',
      'getConsoleErrors',
      { kind: 'ok', value: ERRORS },
      'alice'
    );
    const handlers = createRelayHandlers(relay);
    await handlers.getConsoleErrors!({} as never, { callerUserId: 'alice' });
    mode.current = { kind: 'unaccepted' };

    const alice = await handlers.getConsoleErrors!({} as never, { callerUserId: 'alice' });
    expect(alice).toMatchObject({
      success: true,
      data: ERRORS,
      _meta: {
        fallback: true,
        reason: fallbackReason('getConsoleErrors', 'the last console-errors read'),
      },
    });
    // The unscoped cache was never filled by alice's read.
    expect(await handlers.getConsoleErrors!({} as never)).toEqual(
      noAnswerFailure('getConsoleErrors')
    );
  });
});

// ============================================================================
// getSemanticSnapshot
// ============================================================================

const SEMANTIC = { timestamp: 1, url: 'http://app/', title: 'App', elements: [], summary: 'live' };

describe('relay getSemanticSnapshot · a live answer is the answer', () => {
  it('a live success answers the snapshot, unmarked', async () => {
    const relay = freshRelay();
    tab(relay, 'tab-a', 'getSemanticSnapshot', { kind: 'ok', value: SEMANTIC });
    const handlers = createRelayHandlers(relay);
    expect(await handlers.getSemanticSnapshot!(undefined as never)).toEqual({
      success: true,
      data: SEMANTIC,
      timestamp: expect.any(Number),
    });
  });

  it.each([['reported'], ['inner']] as const)(
    'a live failure (%s) beside a warm cache is that failure, never the cached snapshot',
    async (kind) => {
      const relay = freshRelay();
      const { mode } = tab(relay, 'tab-a', 'getSemanticSnapshot', { kind: 'ok', value: SEMANTIC });
      const handlers = createRelayHandlers(relay);
      await handlers.getSemanticSnapshot!(undefined as never);
      mode.current = { kind };
      expect(await handlers.getSemanticSnapshot!(undefined as never)).toEqual(
        LIVE_FAILURE_ENVELOPE
      );
    }
  );

  it('no live answer with a cache: the cached snapshot, marked', async () => {
    const relay = freshRelay();
    const { mode } = tab(relay, 'tab-a', 'getSemanticSnapshot', { kind: 'ok', value: SEMANTIC });
    const handlers = createRelayHandlers(relay);
    await handlers.getSemanticSnapshot!(undefined as never);
    mode.current = { kind: 'unaccepted' };
    expect(await handlers.getSemanticSnapshot!(undefined as never)).toEqual({
      success: true,
      data: SEMANTIC,
      timestamp: expect.any(Number),
      _meta: {
        fallback: true,
        reason: fallbackReason('getSemanticSnapshot', 'the last semantic snapshot'),
        cacheAgeMs: expect.any(Number),
      },
    });
  });

  it('no live answer and no cache: the failure', async () => {
    const relay = freshRelay();
    tab(relay, 'tab-a', 'getSemanticSnapshot', { kind: 'unaccepted' });
    const handlers = createRelayHandlers(relay);
    expect(await handlers.getSemanticSnapshot!(undefined as never)).toEqual(
      noAnswerFailure('getSemanticSnapshot')
    );
  });
});

// ============================================================================
// getRenderLog / clearRenderLog
// ============================================================================

const LIVE_ENTRY = { id: 'live-1', type: 'render', timestamp: 2 };
const SERVER_ENTRY = { id: 'server-1', type: 'render', timestamp: 1 } as unknown as RenderLogEntry;

function seedServerLog(handlers: ReturnType<typeof createRelayHandlers>): void {
  (handlers as unknown as { __addRenderLogEntry: (e: RenderLogEntry) => void }).__addRenderLogEntry(
    SERVER_ENTRY
  );
}

describe('relay getRenderLog · a live answer is the answer', () => {
  it("a live `entries` answer is the tab's entries, unmarked", async () => {
    const relay = freshRelay();
    tab(relay, 'tab-a', 'getRenderLog', { kind: 'ok', value: { entries: [LIVE_ENTRY] } });
    const handlers = createRelayHandlers(relay);
    seedServerLog(handlers);
    expect(await handlers.getRenderLog!(undefined as never)).toEqual({
      success: true,
      data: [LIVE_ENTRY],
      timestamp: expect.any(Number),
    });
  });

  it.each([['reported'], ['inner']] as const)(
    'a live failure (%s) is that failure, never the server-side log',
    async (kind) => {
      const relay = freshRelay();
      tab(relay, 'tab-a', 'getRenderLog', { kind });
      const handlers = createRelayHandlers(relay);
      seedServerLog(handlers);
      expect(await handlers.getRenderLog!(undefined as never)).toEqual(LIVE_FAILURE_ENVELOPE);
    }
  );

  it.each([
    ['unscoped', undefined],
    ['scoped', { callerUserId: 'alice' }],
  ] as const)(
    '%s: a live answer WITHOUT `entries` is a malformed-answer failure, never an empty list',
    async (_label, context) => {
      const relay = freshRelay();
      tab(relay, 'tab-a', 'getRenderLog', { kind: 'ok', value: { log: [] } }, 'alice');
      const handlers = createRelayHandlers(relay);
      seedServerLog(handlers);
      expect(await handlers.getRenderLog!(undefined as never, context)).toEqual({
        success: false,
        error:
          'The tab answered getRenderLog without an `entries` list, so it reported no render log',
        code: 'UB-UNKNOWN-ERROR',
        timestamp: expect.any(Number),
      });
    }
  );

  it("unscoped, no live answer: the server's log, marked as a fallback", async () => {
    const relay = freshRelay();
    tab(relay, 'tab-a', 'getRenderLog', { kind: 'unaccepted' });
    const handlers = createRelayHandlers(relay);
    seedServerLog(handlers);
    expect(await handlers.getRenderLog!(undefined as never)).toEqual({
      success: true,
      data: [SERVER_ENTRY],
      timestamp: expect.any(Number),
      _meta: {
        fallback: true,
        reason: fallbackReason('getRenderLog', "the server's render log, which names no tab"),
      },
    });
  });

  it('scoped, no live answer: the failure — the server log names no tab, and never success([])', async () => {
    const relay = freshRelay();
    tab(relay, 'tab-a', 'getRenderLog', { kind: 'unaccepted' }, 'alice');
    const handlers = createRelayHandlers(relay);
    seedServerLog(handlers);
    expect(await handlers.getRenderLog!(undefined as never, { callerUserId: 'alice' })).toEqual(
      noAnswerFailure('getRenderLog')
    );
  });
});

describe('relay clearRenderLog · answers its effect (D6)', () => {
  it('a tab confirmed the clear: success', async () => {
    const relay = freshRelay();
    tab(relay, 'tab-a', 'clearRenderLog', { kind: 'ok', value: undefined });
    const handlers = createRelayHandlers(relay);
    expect(await handlers.clearRenderLog!()).toEqual({
      success: true,
      data: undefined,
      timestamp: expect.any(Number),
    });
  });

  it.each([['reported'], ['inner']] as const)(
    'a live failure (%s) is that failure, never success',
    async (kind) => {
      const relay = freshRelay();
      tab(relay, 'tab-a', 'clearRenderLog', { kind });
      const handlers = createRelayHandlers(relay);
      // The tab's verdict, code and payload, and the server log was cleared.
      expect(await handlers.clearRenderLog!()).toEqual({
        ...LIVE_FAILURE_ENVELOPE,
        data: { ...TAB_FAILURE, serverLogCleared: true },
      });
    }
  );

  it("scoped: a live failure keeps the tab's verdict, and says the server-side log was NOT cleared", async () => {
    const relay = freshRelay();
    tab(relay, 'tab-a', 'clearRenderLog', { kind: 'reported' }, 'alice');
    const handlers = createRelayHandlers(relay);
    expect(await handlers.clearRenderLog!({ callerUserId: 'alice' })).toEqual({
      ...LIVE_FAILURE_ENVELOPE,
      data: { ...TAB_FAILURE, serverLogCleared: false },
    });
  });

  it('unscoped, no live answer: a failure whose data says the server-side log WAS cleared', async () => {
    const relay = freshRelay();
    tab(relay, 'tab-a', 'clearRenderLog', { kind: 'unaccepted' }, undefined, {
      kind: 'unaccepted',
    });
    const handlers = createRelayHandlers(relay);
    seedServerLog(handlers);
    expect(await handlers.clearRenderLog!()).toEqual({
      ...noAnswerFailure('clearRenderLog'),
      data: { serverLogCleared: true },
    });
    // It was: the next read with no live answer serves an empty server log.
    const after = await handlers.getRenderLog!(undefined as never);
    expect(after.data).toEqual([]);
  });

  it('scoped, no live answer: a failure whose data says the server-side log was NOT cleared', async () => {
    const relay = freshRelay();
    tab(relay, 'tab-a', 'clearRenderLog', { kind: 'unaccepted' }, 'alice');
    const handlers = createRelayHandlers(relay);
    seedServerLog(handlers);
    expect(await handlers.clearRenderLog!({ callerUserId: 'alice' })).toEqual({
      ...noAnswerFailure('clearRenderLog'),
      data: { serverLogCleared: false },
    });
  });
});

// ============================================================================
// find (relay arm)
// ============================================================================

const CACHED_SNAPSHOT = {
  timestamp: Date.now(),
  elements: [{ id: 'cached-el', type: 'button', label: 'Cached' }],
  components: [],
  workflows: [],
};

describe('relay find · the relay arm', () => {
  /** A tab that serves CACHED_SNAPSHOT for snapshot reads and answers `find` by `mode`. */
  function findTab(relay: CommandRelay, initial: Mode) {
    const mode = { current: initial };
    relay.subscribeToCommands((cmd) => {
      const m: Mode = cmd.action === 'find' ? mode.current : { kind: 'ok', value: CACHED_SNAPSHOT };
      if (m.kind === 'unaccepted') throw new Error('stream write failed');
      setTimeout(() => {
        if (m.kind === 'reported') {
          void relay.rejectCommand(
            cmd.commandId,
            TAB_FAILURE.error,
            'tab-a',
            undefined,
            TAB_FAILURE
          );
          return;
        }
        relay.resolveCommand(cmd.commandId, m.kind === 'inner' ? TAB_FAILURE : m.value, 'tab-a');
      }, 0);
    }, 'tab-a');
    return mode;
  }

  it.each([['reported'], ['inner']] as const)(
    'a NON-refusal live failure (%s) answers that failure, not the cached elements',
    async (kind) => {
      const relay = freshRelay();
      findTab(relay, { kind });
      const handlers = createRelayHandlers(relay);
      await handlers.getControlSnapshot!({ recency: 'current' } as never);

      const result = await handlers.find!({ skipSettle: true } as never);

      expect(result).toEqual(LIVE_FAILURE_ENVELOPE);
      expect(JSON.stringify(result)).not.toContain('cached-el');
    }
  );

  it('no live answer: the cache arm answers the cached elements', async () => {
    const relay = freshRelay();
    findTab(relay, { kind: 'unaccepted' });
    const handlers = createRelayHandlers(relay);
    await handlers.getControlSnapshot!({ recency: 'current' } as never);

    const result = await handlers.find!({ skipSettle: true } as never);

    expect(result.success).toBe(true);
    expect((result.data as { elements: Array<{ id: string }> }).elements.map((e) => e.id)).toEqual([
      'cached-el',
    ]);
    // Marked as the cache's, with find's own cause.
    expect(result._meta).toMatchObject({
      fallback: true,
      reason: fallbackReason('find', 'the cached snapshot'),
    });
  });
});
