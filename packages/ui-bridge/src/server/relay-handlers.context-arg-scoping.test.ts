/**
 * Regression tests for the §4.2 per-user-scoping context-arg hole.
 *
 * The original §4.2 pass closed ownership scoping for every relay handler
 * whose payload could carry `__callerUserId` (executeElementAction,
 * getControlSnapshot, getConsoleErrors, …). Three handlers were left
 * unscoped because their signatures couldn't accept `__callerUserId` in a
 * request bag:
 *
 *   - `captureSnapshot()`   — zero-arg
 *   - `clearRenderLog()`    — zero-arg
 *   - `getElementState(id)` — id-only, no body/query
 *
 * The audit during this follow-up pass extended the list to every other
 * relay-dispatching handler that previously had no plumbing for the
 * authenticated caller. The fix: thread the caller's userId via a
 * dedicated final `context?: HandlerContext` parameter populated by the
 * Next.js / Express / Standalone adapter from the trusted
 * `X-Caller-User-Id` header.
 *
 * Attack scenario reproduced here:
 *
 *   1. Tabs A (alice) and B (bob) are both connected to the same relay.
 *   2. The relay's `primaryTabId` is set to B's tab.
 *   3. Alice calls `POST /control/snapshot` (`captureSnapshot()`) with a
 *      valid auth header (`X-Caller-User-Id: alice`).
 *   4. EXPECTED: the response is TAB_NOT_FOUND / SDK_DISCONNECTED — alice
 *      sees nothing of bob's tab.
 *   5. BEFORE FIX: alice received a snapshot of bob's page.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';

function freshRelay(): CommandRelay {
  const prefix = `__uiBridgeCtxArgTest_${Math.random().toString(36).slice(2, 10)}`;
  return new CommandRelay({ globalPrefix: prefix });
}

function registerOwnedTab(
  relay: CommandRelay,
  tabId: string,
  userId: string
): () => void {
  const unsubscribe = relay.subscribeToCommands(() => {}, tabId);
  relay.recordRegistration(tabId, { userId, sessionId: `${userId}-session` });
  return unsubscribe;
}

describe('relay-handlers · context-arg scoping (§4.2 follow-up)', () => {
  let relay: CommandRelay;

  beforeEach(() => {
    relay = freshRelay();
  });

  afterEach(() => {
    relay.destroy();
  });

  // -------------------------------------------------------------------------
  // captureSnapshot — the named scenario from the brief.
  // -------------------------------------------------------------------------

  describe('captureSnapshot()', () => {
    it('lifts context.callerUserId into ownerCheck', async () => {
      registerOwnedTab(relay, 'tab-a', 'alice');
      const spy = vi.spyOn(relay, 'queueCommand').mockResolvedValue({} as never);
      const handlers = createRelayHandlers(relay);

      await handlers.captureSnapshot!({ callerUserId: 'alice' });

      expect(spy).toHaveBeenCalledTimes(1);
      const [, , opts] = spy.mock.calls[0]!;
      expect(opts).toEqual({ ownerCheck: { userId: 'alice' } });
    });

    it('cross-user attack: bob primary, alice attacks via captureSnapshot → ownerCheck for alice', async () => {
      // Bob's tab registered first → primaryTabId could end up bob's.
      // Alice's tab is registered too. The relay must NOT dispatch
      // alice's captureSnapshot to bob's tab.
      registerOwnedTab(relay, 'tab-b-bob', 'bob');
      registerOwnedTab(relay, 'tab-a-alice', 'alice');
      const spy = vi
        .spyOn(relay, 'queueCommand')
        .mockResolvedValue({ snapshot: 'safe' } as never);
      const handlers = createRelayHandlers(relay);

      await handlers.captureSnapshot!({ callerUserId: 'alice' });

      expect(spy).toHaveBeenCalledTimes(1);
      const [, , opts] = spy.mock.calls[0]!;
      expect((opts as { ownerCheck?: { userId: string } } | undefined)?.ownerCheck).toEqual({
        userId: 'alice',
      });
    });

    it('cross-user enumeration block: attacker with no tabs gets ownerCheck applied (relay will SDK_DISCONNECT)', async () => {
      // Bob has a tab. Eve has none. Eve attacks. The handler MUST set
      // ownerCheck so the relay's owner-scoped fanout short-circuits to
      // SDK_DISCONNECTED instead of dispatching to bob's primary tab.
      registerOwnedTab(relay, 'tab-b-bob', 'bob');

      const spy = vi.spyOn(relay, 'queueCommand');
      const handlers = createRelayHandlers(relay);

      // The relay throws SDK_DISCONNECTED synchronously for eve (no
      // owned tabs + hasOwnerCheck → 0ms reconnect window). The handler
      // re-stamps as a COMMAND_FAILED envelope, which is fine for the
      // attack semantics.
      const result = await handlers.captureSnapshot!({ callerUserId: 'eve' });

      expect(spy).toHaveBeenCalledTimes(1);
      const [, , opts] = spy.mock.calls[0]!;
      expect((opts as { ownerCheck?: { userId: string } } | undefined)?.ownerCheck).toEqual({
        userId: 'eve',
      });
      // The response must be a failure — the relay refused to dispatch
      // because eve owns no tabs. Critically, alice's tab content does
      // NOT appear in the body.
      expect(result.success).toBe(false);
    });

    it('without context, no ownerCheck is applied (admin / trusted path)', async () => {
      registerOwnedTab(relay, 'tab-a', 'alice');
      const spy = vi.spyOn(relay, 'queueCommand').mockResolvedValue({} as never);
      const handlers = createRelayHandlers(relay);

      // No context arg supplied — admin/server-side path.
      await handlers.captureSnapshot!();

      expect(spy).toHaveBeenCalledTimes(1);
      const [, , opts] = spy.mock.calls[0]!;
      expect((opts as { ownerCheck?: unknown } | undefined)?.ownerCheck).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // clearRenderLog — zero-arg, must accept context.
  // -------------------------------------------------------------------------

  describe('clearRenderLog()', () => {
    it('lifts context.callerUserId into ownerCheck for the live-relay leg', async () => {
      registerOwnedTab(relay, 'tab-a', 'alice');
      const spy = vi.spyOn(relay, 'queueCommand').mockResolvedValue({} as never);
      const handlers = createRelayHandlers(relay);

      await handlers.clearRenderLog!({ callerUserId: 'alice' });

      expect(spy).toHaveBeenCalledTimes(1);
      const [action, , opts] = spy.mock.calls[0]!;
      expect(action).toBe('clearRenderLog');
      expect((opts as { ownerCheck?: { userId: string } } | undefined)?.ownerCheck).toEqual({
        userId: 'alice',
      });
    });

    it('cross-user attack: bob cannot clear alice\'s render log via primaryTabId fallback', async () => {
      registerOwnedTab(relay, 'tab-a-alice', 'alice');
      const spy = vi.spyOn(relay, 'queueCommand');
      const handlers = createRelayHandlers(relay);

      // Bob calls clearRenderLog() with his identity. He has no tabs;
      // alice does. The relay must NOT dispatch to alice's tab.
      await handlers.clearRenderLog!({ callerUserId: 'bob' });

      expect(spy).toHaveBeenCalledTimes(1);
      const [, , opts] = spy.mock.calls[0]!;
      expect((opts as { ownerCheck?: { userId: string } } | undefined)?.ownerCheck).toEqual({
        userId: 'bob',
      });
      // The relay will throw SDK_DISCONNECTED for bob (no owned tabs);
      // the handler swallows that error and returns success. The
      // critical invariant is that the ownerCheck was applied.
    });

    it('without context, no ownerCheck is applied', async () => {
      registerOwnedTab(relay, 'tab-a', 'alice');
      const spy = vi.spyOn(relay, 'queueCommand').mockResolvedValue({} as never);
      const handlers = createRelayHandlers(relay);

      await handlers.clearRenderLog!();

      expect(spy).toHaveBeenCalledTimes(1);
      const [, , opts] = spy.mock.calls[0]!;
      expect(opts).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getElementState(id) — id-only signature, must accept context.
  // -------------------------------------------------------------------------

  describe('getElementState(id)', () => {
    it('lifts context.callerUserId into ownerCheck', async () => {
      registerOwnedTab(relay, 'tab-a', 'alice');
      const spy = vi.spyOn(relay, 'queueCommand').mockResolvedValue({ visible: true } as never);
      const handlers = createRelayHandlers(relay);

      await handlers.getElementState!('elem-x', { callerUserId: 'alice' });

      expect(spy).toHaveBeenCalledTimes(1);
      const [action, payload, opts] = spy.mock.calls[0]!;
      expect(action).toBe('getElementState');
      expect(payload).toEqual({ id: 'elem-x' });
      expect((opts as { ownerCheck?: { userId: string } } | undefined)?.ownerCheck).toEqual({
        userId: 'alice',
      });
    });

    it('cross-user attack: alice cannot peek at bob\'s element state', async () => {
      registerOwnedTab(relay, 'tab-b-bob', 'bob');
      const spy = vi.spyOn(relay, 'queueCommand');
      const handlers = createRelayHandlers(relay);

      // Alice (no tabs) asks for an element registered in bob's tab.
      // The relay must NOT dispatch to bob's tab even though it's
      // primaryTabId; the ownerCheck scopes to alice's owned tabs
      // (none) and SDK_DISCONNECTs.
      await handlers.getElementState!('elem-x', { callerUserId: 'alice' });

      expect(spy).toHaveBeenCalledTimes(1);
      const [, , opts] = spy.mock.calls[0]!;
      expect((opts as { ownerCheck?: { userId: string } } | undefined)?.ownerCheck).toEqual({
        userId: 'alice',
      });
    });

    it('without context, no ownerCheck is applied', async () => {
      registerOwnedTab(relay, 'tab-a', 'alice');
      const spy = vi.spyOn(relay, 'queueCommand').mockResolvedValue({} as never);
      const handlers = createRelayHandlers(relay);

      await handlers.getElementState!('elem-x');

      expect(spy).toHaveBeenCalledTimes(1);
      const [, , opts] = spy.mock.calls[0]!;
      expect(opts).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Audit-list spot checks — every other relay-dispatching handler that
  // previously had no plumbing for the caller's userId must now accept
  // and use the context arg. Test a representative sample across each
  // category so regressions surface even if one factory path drifts.
  // -------------------------------------------------------------------------

  describe('audit-list representatives', () => {
    it.each([
      // [handlerName, args] — handler is called with (...args, context).
      ['getElementTree', []],
      ['clearConsoleErrors', []],
      ['getPageSummary', []],
      ['categorizeLastDiff', []],
      ['enableChangeBuffer', []],
      ['disableChangeBuffer', []],
      ['drainChangeBuffer', []],
      ['getChangeBufferSize', []],
      ['listBookmarks', []],
      ['analyzePageData', []],
      ['analyzePageRegions', []],
      ['analyzeStructuredData', []],
      ['pageRefresh', []],
      ['pageGoBack', []],
      ['pageGoForward', []],
      ['exportAnnotations', []],
      ['getAnnotationCoverage', []],
      ['getPerformanceEntries', []],
      ['clearPerformanceEntries', []],
      ['endErrorSession', []],
      ['getErrorSessions', []],
      ['getErrorReport', []],
      ['getStyleGuide', []],
      ['clearStyleGuide', []],
      ['getQualityContexts', []],
      ['getForms', []],
      ['snapshotForms', []],
      ['getClipboard', []],
      ['getNetworkRequestsInFlight', []],
      ['getIdleStatus', []],
      ['getUndoState', []],
      ['executeUndo', []],
      ['executeRedo', []],
      ['getDiagnostics', []],
      ['getRoutes', []],
      // Handlers that take an id but no request bag.
      ['highlightElement', ['elem-x']],
      ['getElementReactState', ['elem-x']],
      ['getComponentState', ['comp-x']],
      ['getElementStyles', ['elem-x']],
      ['getState', ['state-x']],
      ['activateState', ['state-x']],
      ['deactivateState', ['state-x']],
      ['activateStateGroup', ['group-x']],
      ['deactivateStateGroup', ['group-x']],
      ['canExecuteTransition', ['trans-x']],
      ['executeTransition', ['trans-x']],
      ['getBookmark', ['name-x']],
      ['deleteBookmark', ['name-x']],
      ['diffFromBookmark', ['name-x']],
      ['deleteIntent', ['name-x']],
      ['getAnnotation', ['elem-x']],
      ['deleteAnnotation', ['elem-x']],
      ['getNetworkRequest', ['req-x']],
      ['getIdleSignalStatus', ['signal-x']],
    ])('%s passes context.callerUserId through to relay opts', async (handlerName, args) => {
      registerOwnedTab(relay, 'tab-a', 'alice');
      const spy = vi.spyOn(relay, 'queueCommand').mockResolvedValue({} as never);
      const handlers = createRelayHandlers(relay);

      const fn = (handlers as Record<string, unknown>)[handlerName] as (
        ...a: unknown[]
      ) => Promise<unknown>;
      expect(fn).toBeDefined();

      await fn(...args, { callerUserId: 'alice' });

      expect(spy).toHaveBeenCalled();
      const opts = spy.mock.calls[spy.mock.calls.length - 1]![2];
      expect((opts as { ownerCheck?: { userId: string } } | undefined)?.ownerCheck).toEqual({
        userId: 'alice',
      });
    });
  });
});

