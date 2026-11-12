/**
 * The relay's `getElement`: a LIVE answer is the answer, and the cache answers
 * only when there was none — marked as the cache's when it does (plan
 * 2026-11-08-ui-bridge-inject-exec-mode-is-a-second-class-driver, Phase 3, D3
 * as resolved by the vet; review round 1, W3).
 *
 * Before Phase 3 the in-page dispatcher had no `getElement` case, so every live
 * read threw and the relay's unpinned read answered from its cached snapshot.
 * Now the dispatcher answers, and a not-found comes back as a FAILURE — resolved
 * as `{ success: false, … ELEMENT_NOT_FOUND }`, or rejected with its message,
 * which is how the in-page relay client delivers every returned failure
 * (`relay-client.ts` posts `success: false`, and `nextjs.ts` settles that with
 * `rejectCommand`). A cache answer to either would be `success(element)` from a
 * stale or other-tab cache for an id the live page just said is gone.
 *
 * So the cache answers only the three causes of NO live answer — no connected
 * tab, a timeout, a tab whose SDK predates the case (`Unknown command action:
 * getElement`) — and its answer carries `_meta: { fallback: true, reason }`,
 * the marker `relayWithFallback` puts on its default.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';

const relays: CommandRelay[] = [];

function freshRelay(options: { sseTimeoutMs?: number } = {}): CommandRelay {
  // CommandRelay persists state on globalThis for HMR survival; a per-test
  // prefix keeps one test's tabs and pending commands out of the next.
  const prefix = `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`;
  const relay = new CommandRelay({ globalPrefix: prefix, ...options });
  relays.push(relay);
  return relay;
}

afterEach(() => {
  vi.useRealTimers();
  for (const relay of relays.splice(0)) relay.destroy();
});

const ID = 'save-btn';

/** One snapshot element, as `serializeRegisteredElement` shapes it (the fields the relay reads). */
function element(label: string): Record<string, unknown> {
  return {
    id: ID,
    type: 'button',
    tagName: 'button',
    label,
    actions: ['click'],
    state: { visible: true, enabled: true, focused: false },
  };
}

/** The snapshot the tab served before the element went away. */
const STALE_SNAPSHOT = {
  timestamp: Date.now(),
  elements: [element('Save (cached)')],
  components: [],
  workflows: [],
};

/** The dispatcher's returned not-found, exactly as `createActionFailure` builds it. */
const DISPATCHER_NOT_FOUND = {
  success: false,
  error: `Element ${ID} not found`,
  failureDetails: {
    errorCode: 'ELEMENT_NOT_FOUND',
    message: `Element ${ID} not found`,
    elementId: ID,
    selectorsTried: [`registry:${ID}`],
    suggestedActions: [],
    retryRecommended: false,
    durationMs: 1,
  },
  durationMs: 1,
  timestamp: Date.now(),
};

/** The same verdict with a hoisted handler code, the form the plan names. */
const HOISTED_NOT_FOUND = {
  success: false,
  error: `Element ${ID} not found`,
  code: 'ELEMENT_NOT_FOUND',
};

/** The `_meta` the cache's answer carries for one no-live-answer cause, spelled out. */
function fallbackMeta(cause: string) {
  return {
    fallback: true,
    reason: `Relay command 'getElement' got no live answer (${cause}) — answered from the cached snapshot, which can be stale or another tab's.`,
  };
}

type GetElementAnswer =
  | { kind: 'resolve'; value: unknown }
  | { kind: 'reject'; message: string }
  | { kind: 'silent' };

/**
 * A tab that serves `STALE_SNAPSHOT` for every snapshot read (so the cache
 * holds the id) and answers `getElement` as `answer` says: resolves it,
 * rejects it with a message (how `nextjs.ts` settles the in-page relay
 * client's `success: false` post), or never answers it. `close` disconnects
 * the tab.
 */
function tab(
  relay: CommandRelay,
  tabId: string,
  answer: GetElementAnswer
): { seen: string[]; close: () => void } {
  const seen: string[] = [];
  const close = relay.subscribeToCommands((cmd) => {
    seen.push(cmd.action);
    if (cmd.action === 'getElement' && answer.kind === 'silent') return;
    setTimeout(() => {
      if (cmd.action === 'getElement' && answer.kind === 'reject') {
        relay.rejectCommand(cmd.commandId, answer.message, tabId);
        return;
      }
      const result =
        cmd.action === 'getElement' && answer.kind === 'resolve' ? answer.value : STALE_SNAPSHOT;
      relay.resolveCommand(cmd.commandId, result, tabId);
    }, 0);
  }, tabId);
  return { seen, close };
}

/** Fill the unscoped snapshot cache, and prove it now holds the id. */
async function warmCache(handlers: ReturnType<typeof createRelayHandlers>): Promise<void> {
  const snap = await handlers.getControlSnapshot!({ recency: 'current' } as never);
  expect(snap.success).toBe(true);
  expect((snap.data as { elements: Array<{ id: string }> }).elements.map((e) => e.id)).toContain(
    ID
  );
}

describe('relay getElement · unpinned · a live answer is the answer', () => {
  it.each([
    [
      'the dispatcher envelope (failureDetails.errorCode)',
      DISPATCHER_NOT_FOUND,
      'UB-ELEM-NOT-FOUND',
    ],
    ['a hoisted code', HOISTED_NOT_FOUND, 'ELEMENT_NOT_FOUND'],
  ])(
    '(a) a RESOLVED live not-found (%s) beside a stale cache that still holds the id is a FAILURE, never success(cached)',
    async (_label, liveAnswer, code) => {
      const relay = freshRelay();
      const { seen } = tab(relay, 'tab-a', { kind: 'resolve', value: liveAnswer });
      const handlers = createRelayHandlers(relay);
      await warmCache(handlers);

      const result = await handlers.getElement!(ID);

      expect(seen).toContain('getElement');
      expect(result.success).toBe(false);
      expect(result.error).toBe(`Element ${ID} not found`);
      expect(result.code).toBe(code);
      // The browser's verdict is carried verbatim — not the cached element.
      expect(result.data).toEqual(liveAnswer);
      expect((result.data as { label?: unknown }).label).toBeUndefined();
      expect(result._meta).toBeUndefined();
    }
  );

  it.each([
    // What the in-page relay client delivers for the dispatcher's RETURNED
    // not-found: its `error`, through `rejectCommand`.
    ["the dispatcher's not-found", `Element ${ID} not found`],
    ['a registration whose DOM node is gone', `DOM element for ${ID} not found`],
    ['a crash in the handler', "Cannot read properties of undefined (reading 'state')"],
    // The no-case message of ANOTHER action is not this action's.
    ["another action's no-case", 'Unknown command action: getElementState'],
  ])(
    '(a) a REJECTED live answer (%s) beside a stale cache that still holds the id is a FAILURE, never success(cached)',
    async (_label, message) => {
      const relay = freshRelay();
      const { seen } = tab(relay, 'tab-a', { kind: 'reject', message });
      const handlers = createRelayHandlers(relay);
      await warmCache(handlers);

      const result = await handlers.getElement!(ID);

      expect(seen).toContain('getElement');
      expect(result).toEqual({
        success: false,
        error: message,
        code: 'UB-ACTION-FAILED',
        timestamp: expect.any(Number),
      });
    }
  );

  it("a rejected live answer gets the pinned read's envelope, field for field", async () => {
    const message = `Element ${ID} not found`;
    const relay = freshRelay();
    tab(relay, 'tab-a', { kind: 'reject', message });
    const handlers = createRelayHandlers(relay);
    await warmCache(handlers);

    const { timestamp: _u, ...unpinned } = await handlers.getElement!(ID);
    const { timestamp: _p, ...pinned } = await handlers.getElement!(ID, {
      tabId: 'tab-a',
    } as never);

    expect(unpinned).toEqual(pinned);
    expect(unpinned).toMatchObject({ success: false, error: message });
  });

  it('a live element is answered live, unmarked, not from the cache', async () => {
    const relay = freshRelay();
    tab(relay, 'tab-a', { kind: 'resolve', value: element('Save (live)') });
    const handlers = createRelayHandlers(relay);
    await warmCache(handlers);

    const result = await handlers.getElement!(ID);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ id: ID, label: 'Save (live)' });
    expect(result._meta).toBeUndefined();
  });
});

describe('relay getElement · unpinned · NO live answer: the cache answers, marked as a fallback', () => {
  it("(b) a tab whose SDK has no getElement case (it threw 'Unknown command action: getElement')", async () => {
    const relay = freshRelay();
    tab(relay, 'tab-a', { kind: 'reject', message: 'Unknown command action: getElement' });
    const handlers = createRelayHandlers(relay);
    await warmCache(handlers);

    const result = await handlers.getElement!(ID);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ id: ID, label: 'Save (cached)' });
    expect(result._meta).toEqual(fallbackMeta("the tab's UI Bridge SDK has no getElement case"));
  });

  it('(b) no connected tab (the relay raises SDK_DISCONNECTED)', async () => {
    const relay = freshRelay();
    const { close } = tab(relay, 'tab-a', { kind: 'resolve', value: element('Save (live)') });
    const handlers = createRelayHandlers(relay);
    await warmCache(handlers);
    // The only tab disconnects; the cache still holds its snapshot.
    close();

    vi.useFakeTimers();
    const pending = handlers.getElement!(ID);
    // queueCommand waits up to 3 s for a transport, then raises SDK_DISCONNECTED.
    await vi.advanceTimersByTimeAsync(3_000);
    const result = await pending;

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ id: ID, label: 'Save (cached)' });
    expect(result._meta).toEqual(fallbackMeta('no browser tab is connected to receive it'));
  });

  it('(b) a tab that never answers (the relay times out)', async () => {
    const relay = freshRelay({ sseTimeoutMs: 50 });
    const { seen } = tab(relay, 'tab-a', { kind: 'silent' });
    const handlers = createRelayHandlers(relay);
    await warmCache(handlers);

    const result = await handlers.getElement!(ID);

    expect(seen).toContain('getElement');
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ id: ID, label: 'Save (cached)' });
    expect(result._meta).toEqual(fallbackMeta('no tab answered it in time'));
  });

  it("an id the cache does not hold either is a not-found, marked as the cache's", async () => {
    const relay = freshRelay();
    tab(relay, 'tab-a', { kind: 'reject', message: 'Unknown command action: getElement' });
    const handlers = createRelayHandlers(relay);
    await warmCache(handlers);

    const result = await handlers.getElement!('missing-btn');

    expect(result.success).toBe(false);
    expect(result.code).toBe('UB-ELEM-NOT-FOUND');
    expect(result.error).toBe(
      'Element "missing-btn" not found in the cached snapshot (1 elements registered). Use find() or getControlSnapshot() to see available elements.'
    );
    expect(result._meta).toEqual(fallbackMeta("the tab's UI Bridge SDK has no getElement case"));
  });
});

describe('relay getElement · pinned to a tab', () => {
  it("the tab's returned not-found is a failure envelope carrying its verdict", async () => {
    const relay = freshRelay();
    tab(relay, 'tab-a', { kind: 'resolve', value: DISPATCHER_NOT_FOUND });
    const handlers = createRelayHandlers(relay);

    const result = await handlers.getElement!(ID, { tabId: 'tab-a' } as never);

    expect(result.success).toBe(false);
    expect(result.code).toBe('UB-ELEM-NOT-FOUND');
    expect(result.error).toBe(`Element ${ID} not found`);
    expect(result.data).toEqual(DISPATCHER_NOT_FOUND);
  });

  it("the tab's element is the answer", async () => {
    const relay = freshRelay();
    tab(relay, 'tab-a', { kind: 'resolve', value: element('Save (live)') });
    const handlers = createRelayHandlers(relay);

    const result = await handlers.getElement!(ID, { tabId: 'tab-a' } as never);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ id: ID, label: 'Save (live)' });
  });
});
