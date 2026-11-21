/**
 * TIMEOUT is classified on the relay's typed kind (plan
 * 2026-11-21-ui-bridge-relay-pr-423-follow-ups-local-delivery-registration-poll-branch-timeout-kind,
 * item 4): `NoLiveAnswer` with reason `unanswered`, never a substring of the
 * message.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';
import { NoLiveAnswer, noResultArrivedMessage } from './live-answer';

const relays: CommandRelay[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const relay of relays.splice(0)) relay.destroy();
});

function rigWith(error: Error) {
  const relay = new CommandRelay({
    globalPrefix: `__timeoutkind_${Math.random().toString(36).slice(2, 10)}`,
    proactiveSnapshot: false,
  });
  relays.push(relay);
  // A tab is connected, so the no-tab hint does not mask the timeout arm.
  relay.subscribeToCommands(() => undefined, 'tab-a');
  vi.spyOn(relay, 'queueCommand').mockRejectedValue(error);
  return createRelayHandlers(relay);
}

const click = (handlers: ReturnType<typeof createRelayHandlers>) =>
  handlers.executeElementAction!('foo', {
    action: 'click',
  } as unknown as Parameters<typeof handlers.executeElementAction>[1]);

describe('relay-handlers · TIMEOUT is classified on the NoLiveAnswer kind', () => {
  it('an unanswered relay timeout (D6 text, "timed out") answers TIMEOUT', async () => {
    const handlers = rigWith(
      new NoLiveAnswer(noResultArrivedMessage('click', 5000, 'SSE', 1), 'unanswered')
    );
    const result = await click(handlers);
    expect(result.success).toBe(false);
    // `mapInternalErrorCode` canonicalizes TIMEOUT to the UB diagnostic code.
    expect(result.code).toBe('UB-ACTION-TIMEOUT');
    expect(result.error).not.toContain('page may be unresponsive');
    expect(result.error).toContain('no result reached');
  });

  it('a not_delivered answer whose text contains "timeoutMs" is not TIMEOUT', async () => {
    const handlers = rigWith(
      new NoLiveAnswer(
        'SDK_DISCONNECTED: No browser connected. Use `GET /tabs/wait?timeoutMs=<ms>` to block.',
        'not_delivered'
      )
    );
    const result = await click(handlers);
    expect(result.success).toBe(false);
    expect(result.code).not.toBe('UB-ACTION-TIMEOUT');
    expect(JSON.stringify(result.suggestions ?? [])).not.toContain('browser tab is responsive');
    expect(result.error).not.toContain('did not respond');
  });

  it('a plain Error that mentions "timeout" is not TIMEOUT', async () => {
    const handlers = rigWith(new Error('upstream timeout while reading the DOM'));
    const result = await click(handlers);
    expect(result.success).toBe(false);
    expect(result.code).not.toBe('UB-ACTION-TIMEOUT');
  });
});
