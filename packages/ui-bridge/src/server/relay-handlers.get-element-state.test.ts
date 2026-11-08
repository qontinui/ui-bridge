/**
 * The relay's `getElementState`: a LIVE answer is the answer, and the cached
 * snapshot answers only when there was none — marked as the cache's when it
 * does (plan 2026-11-08-ui-bridge-inject-exec-mode-is-a-second-class-driver,
 * review round 1 follow-through; the rule `getElement`'s unpinned read follows,
 * `relay-handlers.get-element.test.ts`).
 *
 * The read used to answer EVERY rejection from the cache. The in-page
 * dispatcher's `getElementState` case throws `Element <id> not found` for an id
 * the page does not hold, and that throw reaches the relay as a rejection, so
 * an element the live page had just lost was answered `success(<cached
 * state>)`, unmarked, from a cache that can be stale or another tab's. Now only
 * the three causes of NO live answer — no connected tab, a timeout, a tab whose
 * SDK has no case — reach the cache, and its answer carries
 * `_meta: { fallback: true, reason }`.
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

/** The state the cached snapshot holds for the element. */
const CACHED_STATE = { visible: true, enabled: true, focused: false, textContent: 'Save (cached)' };

/** The snapshot the tab served before the element went away. */
const STALE_SNAPSHOT = {
  timestamp: Date.now(),
  elements: [
    {
      id: ID,
      type: 'button',
      tagName: 'button',
      label: 'Save',
      actions: ['click'],
      state: CACHED_STATE,
    },
  ],
  components: [],
  workflows: [],
};

/** What the dispatcher's `getElementState` case answers: the id, the state, its legacy aliases. */
const LIVE_STATE = {
  id: ID,
  visible: true,
  enabled: false,
  focused: true,
  textContent: 'Save (live)',
  isVisible: true,
  isEnabled: false,
  text: 'Save (live)',
};

/** The `_meta` the cache's answer carries for one no-live-answer cause, spelled out. */
function fallbackMeta(cause: string) {
  return {
    fallback: true,
    reason: `Relay command 'getElementState' got no live answer (${cause}) — answered from the cached snapshot, which can be stale or another tab's.`,
  };
}

type StateAnswer =
  | { kind: 'resolve'; value: unknown }
  | { kind: 'reject'; message: string }
  | { kind: 'silent' };

/**
 * A tab that serves `STALE_SNAPSHOT` for every snapshot read (so the cache
 * holds the id) and answers `getElementState` as `answer` says: resolves it,
 * rejects it with a message (how `nextjs.ts` settles the in-page relay
 * client's report of a thrown or returned failure), or never answers it.
 * `close` disconnects the tab.
 */
function tab(
  relay: CommandRelay,
  tabId: string,
  answer: StateAnswer
): { seen: string[]; close: () => void } {
  const seen: string[] = [];
  const close = relay.subscribeToCommands((cmd) => {
    seen.push(cmd.action);
    const isRead = cmd.action === 'getElementState';
    if (isRead && answer.kind === 'silent') return;
    setTimeout(() => {
      if (isRead && answer.kind === 'reject') {
        relay.rejectCommand(cmd.commandId, answer.message, tabId);
        return;
      }
      const result = isRead && answer.kind === 'resolve' ? answer.value : STALE_SNAPSHOT;
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

describe('relay getElementState · a live answer is the answer', () => {
  it('a live state is answered live, unmarked, not from the cache', async () => {
    const relay = freshRelay();
    tab(relay, 'tab-a', { kind: 'resolve', value: LIVE_STATE });
    const handlers = createRelayHandlers(relay);
    await warmCache(handlers);

    const result = await handlers.getElementState!(ID);

    expect(result.success).toBe(true);
    expect(result.data).toEqual(LIVE_STATE);
    expect(result._meta).toBeUndefined();
  });

  it.each([
    // What the dispatcher's getElementState case THROWS for an id the page
    // does not hold, delivered through `rejectCommand`.
    ["the dispatcher's not-found", `Element ${ID} not found`],
    ['a crash in the handler', "Cannot read properties of undefined (reading 'getState')"],
    // The no-case message of ANOTHER action, or of a longer action id, is not
    // this action's.
    ["another action's no-case", 'Unknown command action: getElement'],
    ['a longer action id', 'Unknown command action: getElementStates'],
  ])(
    'a REJECTED live answer (%s) beside a cache that holds the id is a FAILURE, never success(cached state)',
    async (_label, message) => {
      const relay = freshRelay();
      const { seen } = tab(relay, 'tab-a', { kind: 'reject', message });
      const handlers = createRelayHandlers(relay);
      await warmCache(handlers);

      const result = await handlers.getElementState!(ID);

      expect(seen).toContain('getElementState');
      expect(result).toEqual({
        success: false,
        error: message,
        code: 'UB-ACTION-FAILED',
        timestamp: expect.any(Number),
      });
    }
  );

  it("a RESOLVED inner failure is a failure envelope carrying the tab's verdict", async () => {
    const verdict = {
      success: false,
      error: `Element ${ID} not found`,
      failureDetails: { errorCode: 'ELEMENT_NOT_FOUND', message: `Element ${ID} not found` },
    };
    const relay = freshRelay();
    tab(relay, 'tab-a', { kind: 'resolve', value: verdict });
    const handlers = createRelayHandlers(relay);
    await warmCache(handlers);

    const result = await handlers.getElementState!(ID);

    expect(result.success).toBe(false);
    expect(result.code).toBe('UB-ELEM-NOT-FOUND');
    expect(result.error).toBe(`Element ${ID} not found`);
    expect(result.data).toEqual(verdict);
    expect(result._meta).toBeUndefined();
  });
});

describe('relay getElementState · NO live answer: the cache answers, marked as a fallback', () => {
  it("a tab whose SDK has no getElementState case (it threw 'Unknown command action: getElementState')", async () => {
    const relay = freshRelay();
    tab(relay, 'tab-a', { kind: 'reject', message: 'Unknown command action: getElementState' });
    const handlers = createRelayHandlers(relay);
    await warmCache(handlers);

    const result = await handlers.getElementState!(ID);

    expect(result.success).toBe(true);
    expect(result.data).toEqual(CACHED_STATE);
    expect(result._meta).toEqual(
      fallbackMeta("the tab's UI Bridge SDK has no getElementState case")
    );
  });

  it('no connected tab (the relay raises SDK_DISCONNECTED)', async () => {
    const relay = freshRelay();
    const { close } = tab(relay, 'tab-a', { kind: 'resolve', value: LIVE_STATE });
    const handlers = createRelayHandlers(relay);
    await warmCache(handlers);
    // The only tab disconnects; the cache still holds its snapshot.
    close();

    vi.useFakeTimers();
    const pending = handlers.getElementState!(ID);
    // queueCommand waits up to 3 s for a transport, then raises SDK_DISCONNECTED.
    await vi.advanceTimersByTimeAsync(3_000);
    const result = await pending;

    expect(result.success).toBe(true);
    expect(result.data).toEqual(CACHED_STATE);
    expect(result._meta).toEqual(fallbackMeta('no browser tab is connected to receive it'));
  });

  it('a tab that never answers (the relay times out)', async () => {
    const relay = freshRelay({ sseTimeoutMs: 50 });
    const { seen } = tab(relay, 'tab-a', { kind: 'silent' });
    const handlers = createRelayHandlers(relay);
    await warmCache(handlers);

    const result = await handlers.getElementState!(ID);

    expect(seen).toContain('getElementState');
    expect(result.success).toBe(true);
    expect(result.data).toEqual(CACHED_STATE);
    expect(result._meta).toEqual(fallbackMeta('no tab answered it in time'));
  });

  it("an id the cache does not hold either is a not-found, marked as the cache's", async () => {
    const relay = freshRelay();
    tab(relay, 'tab-a', { kind: 'reject', message: 'Unknown command action: getElementState' });
    const handlers = createRelayHandlers(relay);
    await warmCache(handlers);

    const result = await handlers.getElementState!('missing-btn');

    expect(result.success).toBe(false);
    expect(result.code).toBe('UB-ELEM-NOT-FOUND');
    expect(result.error).toBe(
      `Element state for "missing-btn" is not in the cached snapshot, and the relay got no live answer (the tab's UI Bridge SDK has no getElementState case).`
    );
    expect(result._meta).toEqual(
      fallbackMeta("the tab's UI Bridge SDK has no getElementState case")
    );
  });
});
