/**
 * Relay-handlers layer test for per-user tab scoping (§4.2).
 *
 * The Next.js adapter populates `__callerUserId` from the trusted
 * `X-Caller-User-Id` request header (set by qontinui-web's auth gate).
 * `relay-handlers.extractTabRouting` must lift that field into an
 * `ownerCheck.userId` option on the downstream `relay.queueCommand`
 * call, and `OwnerMismatchError` must surface as a TAB_NOT_FOUND
 * envelope with HTTP 404 (no enumeration leak).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRelay, OwnerMismatchError } from './command-relay';
import { createRelayHandlers } from './relay-handlers';

function freshRelay(): CommandRelay {
  const prefix = `__uiBridgeOwnerCheckTest_${Math.random().toString(36).slice(2, 10)}`;
  return new CommandRelay({ globalPrefix: prefix });
}

function registerOwnedTab(relay: CommandRelay, tabId: string, userId: string): () => void {
  const unsubscribe = relay.subscribeToCommands(() => {}, tabId);
  relay.recordRegistration(tabId, { userId, sessionId: `${userId}-session` });
  return unsubscribe;
}

describe('relay-handlers · per-user scoping (§4.2)', () => {
  let relay: CommandRelay;

  beforeEach(() => {
    relay = freshRelay();
  });

  afterEach(() => {
    relay.destroy();
  });

  it('lifts __callerUserId from the payload into ownerCheck on queueCommand', async () => {
    registerOwnedTab(relay, 'tab-a', 'alice');
    const spy = vi.spyOn(relay, 'queueCommand').mockResolvedValue({} as never);
    const handlers = createRelayHandlers(relay);

    // executeElementAction is the canonical mutating route. The Next.js
    // adapter splices __callerUserId into the body before this is called.
    await handlers.executeElementAction!('elem-1', {
      action: 'click',
      tabId: 'tab-a',
      __callerUserId: 'alice',
    } as unknown as Parameters<typeof handlers.executeElementAction>[1]);

    expect(spy).toHaveBeenCalledTimes(1);
    const [, payload, opts] = spy.mock.calls[0]!;
    expect(opts).toEqual({
      targetTabId: 'tab-a',
      ownerCheck: { userId: 'alice' },
    });
    // payload must NOT leak __callerUserId / tabId to the browser.
    const request = (payload as Record<string, unknown> | undefined)?.request as
      | Record<string, unknown>
      | undefined;
    expect(request?.tabId).toBeUndefined();
    expect(request?.__callerUserId).toBeUndefined();
  });

  it('OwnerMismatchError → TAB_NOT_FOUND envelope with httpStatus 404 (redaction)', async () => {
    registerOwnedTab(relay, 'tab-a', 'alice');
    registerOwnedTab(relay, 'tab-b', 'bob');
    const handlers = createRelayHandlers(relay);

    // Eve, with no tabs of her own, addresses Bob's tab.
    const result = await handlers.executeElementAction!('elem-1', {
      action: 'click',
      tabId: 'tab-b',
      __callerUserId: 'eve',
    } as unknown as Parameters<typeof handlers.executeElementAction>[1]);

    expect(result.success).toBe(false);
    // 404, NOT 403 — caller must not be able to distinguish "tab exists
    // but not yours" from "tab does not exist".
    expect((result as { code?: string }).code).toBe('TAB_NOT_FOUND');
    expect((result as { httpStatus?: number }).httpStatus).toBe(404);
    // CRITICAL: the prose must not echo bob, tab-b ownership, or any signal
    // that other users' tabs exist.
    expect(result.error).not.toContain('bob');
    expect(result.error).not.toContain('mismatch');
    expect(result.error).not.toContain('OWNER');
  });

  it('matching ownerCheck routes through normally', async () => {
    registerOwnedTab(relay, 'tab-a', 'alice');
    const spy = vi.spyOn(relay, 'queueCommand').mockResolvedValue({ ok: true } as never);
    const handlers = createRelayHandlers(relay);

    const result = await handlers.executeElementAction!('elem-1', {
      action: 'click',
      tabId: 'tab-a',
      __callerUserId: 'alice',
    } as unknown as Parameters<typeof handlers.executeElementAction>[1]);

    expect(result.success).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('omitting __callerUserId leaves admin-style ownerCheck-less dispatch', async () => {
    registerOwnedTab(relay, 'tab-a', 'alice');
    const spy = vi.spyOn(relay, 'queueCommand').mockResolvedValue({} as never);
    const handlers = createRelayHandlers(relay);

    await handlers.executeElementAction!('elem-1', {
      action: 'click',
      tabId: 'tab-a',
    } as unknown as Parameters<typeof handlers.executeElementAction>[1]);

    expect(spy).toHaveBeenCalledTimes(1);
    const [, , opts] = spy.mock.calls[0]!;
    expect(opts).toEqual({ targetTabId: 'tab-a' });
    expect((opts as { ownerCheck?: unknown }).ownerCheck).toBeUndefined();
  });

  it('throws OwnerMismatchError from the relay when called outside the handler', async () => {
    // Belt-and-braces — verify the relay's own throw path so the handler
    // envelope shape isn't masking a regression in the relay layer.
    registerOwnedTab(relay, 'tab-b', 'bob');
    await expect(
      relay.queueCommand(
        'click',
        {},
        { targetTabId: 'tab-b', ownerCheck: { userId: 'eve' } },
      ),
    ).rejects.toBeInstanceOf(OwnerMismatchError);
  });
});
