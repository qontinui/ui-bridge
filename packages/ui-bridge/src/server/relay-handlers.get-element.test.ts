/**
 * The relay's `getElement`: a live not-found is a FAILURE, never the cache's
 * success (plan 2026-11-08-ui-bridge-inject-exec-mode-is-a-second-class-driver,
 * Phase 3, D3 as resolved by the vet).
 *
 * Before Phase 3 the in-page dispatcher had no `getElement` case, so every live
 * read threw and the relay's unpinned read answered from its cached snapshot.
 * Now the dispatcher answers, and a not-found comes back RETURNED as
 * `{ success: false, … ELEMENT_NOT_FOUND }`. The unpinned call site used to
 * read `if (result) return success(result)`, which would have wrapped that
 * failure as a success; falling through to the cache instead would answer
 * `success(element)` from a stale or other-tab cache for an id the live page
 * just said is gone. Both are refused here: a LIVE answer is the answer, and
 * the cache answers only when there was no live answer at all (a tab whose SDK
 * predates the case throws `Unknown command action`).
 */

import { describe, expect, it } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';

function freshRelay(): CommandRelay {
  // CommandRelay persists state on globalThis for HMR survival; a per-test
  // prefix keeps one test's tabs and pending commands out of the next.
  const prefix = `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`;
  return new CommandRelay({ globalPrefix: prefix });
}

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

type GetElementAnswer = { kind: 'resolve'; value: unknown } | { kind: 'reject'; message: string };

/**
 * A tab that serves `STALE_SNAPSHOT` for every snapshot read (so the cache
 * holds the id) and answers `getElement` as `answer` says.
 */
function tab(relay: CommandRelay, tabId: string, answer: GetElementAnswer): string[] {
  const seen: string[] = [];
  relay.subscribeToCommands((cmd) => {
    seen.push(cmd.action);
    setTimeout(() => {
      if (cmd.action === 'getElement' && answer.kind === 'reject') {
        relay.rejectCommand(cmd.commandId, answer.message, tabId);
        return;
      }
      const result = cmd.action === 'getElement' ? answer.value : STALE_SNAPSHOT;
      relay.resolveCommand(cmd.commandId, result, tabId);
    }, 0);
  }, tabId);
  return seen;
}

/** Fill the unscoped snapshot cache, and prove it now holds the id. */
async function warmCache(handlers: ReturnType<typeof createRelayHandlers>): Promise<void> {
  const snap = await handlers.getControlSnapshot!({ recency: 'current' } as never);
  expect(snap.success).toBe(true);
  expect((snap.data as { elements: Array<{ id: string }> }).elements.map((e) => e.id)).toContain(
    ID
  );
}

describe('relay getElement · unpinned', () => {
  it.each([
    [
      'the dispatcher envelope (failureDetails.errorCode)',
      DISPATCHER_NOT_FOUND,
      'UB-ELEM-NOT-FOUND',
    ],
    ['a hoisted code', HOISTED_NOT_FOUND, 'ELEMENT_NOT_FOUND'],
  ])(
    '(a) a LIVE not-found (%s) beside a stale cache that still holds the id is a FAILURE, never success(cached)',
    async (_label, liveAnswer, code) => {
      const relay = freshRelay();
      const seen = tab(relay, 'tab-a', { kind: 'resolve', value: liveAnswer });
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
    }
  );

  it('(b) a browser that THROWS (an SDK with no getElement case) falls back to the cached element', async () => {
    const relay = freshRelay();
    tab(relay, 'tab-a', { kind: 'reject', message: 'Unknown command action: getElement' });
    const handlers = createRelayHandlers(relay);
    await warmCache(handlers);

    const result = await handlers.getElement!(ID);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ id: ID, label: 'Save (cached)' });
  });

  it('a live element is answered live, not from the cache', async () => {
    const relay = freshRelay();
    tab(relay, 'tab-a', { kind: 'resolve', value: element('Save (live)') });
    const handlers = createRelayHandlers(relay);
    await warmCache(handlers);

    const result = await handlers.getElement!(ID);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ id: ID, label: 'Save (live)' });
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
