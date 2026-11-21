/**
 * A command the relay delivered and no result came back for rejects with
 * `NoLiveAnswer` (reason `unanswered`), whose message reads "timed out" (plan
 * `2026-11-08-ui-bridge-relay-client-drops-refused-results-and-heartbeats-silently`
 * D6). The HTTP layer classified a timeout by the word "timeout", which that
 * message never contains, so the relay's own timeout answered `COMMAND_FAILED`
 * (`UB-ACTION-FAILED` on the wire) with no suggestions. These tests pin the
 * typed classification: `TIMEOUT` (`UB-ACTION-TIMEOUT`),
 * no "the browser did not respond" hint contradicting the message (the tab
 * may have answered and its result been refused), and a suggestion to read
 * the page before retrying an action that may already have run.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';
import { NoLiveAnswer } from './live-answer';

const relays: CommandRelay[] = [];

afterEach(() => {
  for (const relay of relays.splice(0)) relay.destroy();
});

function freshRelay(): CommandRelay {
  const relay = new CommandRelay({
    globalPrefix: `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`,
    proactiveSnapshot: false,
    sseTimeoutMs: 50,
  });
  relays.push(relay);
  return relay;
}

describe('relay-handlers · a delivered command no result came back for', () => {
  it('answers UB-ACTION-TIMEOUT, not UB-ACTION-FAILED, for the relay-raised timeout', async () => {
    const relay = freshRelay();
    relay.subscribeToCommands(() => undefined, 'tab-a');
    const handlers = createRelayHandlers(relay);

    const result = await handlers.executeElementAction!('foo', {
      action: 'click',
    } as unknown as Parameters<typeof handlers.executeElementAction>[1]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out after 50ms');
    expect(result.error).toContain('no result reached this relay instance');
    expect(result.code).toBe('UB-ACTION-TIMEOUT');
    expect(result.error).not.toContain('The browser did not respond in time');
    expect((result as { suggestions?: string[] }).suggestions).toContain(
      'The tab may have run the command: read the page state before retrying an action that changes it'
    );
  });

  it('classifies an unanswered NoLiveAnswer by type whatever its message says', async () => {
    const relay = freshRelay();
    relay.subscribeToCommands(() => undefined, 'tab-a');
    relay.queueCommand = (() =>
      Promise.reject(new NoLiveAnswer('no answer came back', 'unanswered'))) as never;
    const handlers = createRelayHandlers(relay);

    const result = await handlers.executeElementAction!('foo', {
      action: 'click',
    } as unknown as Parameters<typeof handlers.executeElementAction>[1]);

    expect(result.code).toBe('UB-ACTION-TIMEOUT');
  });

  it('does not classify the real not-delivered rejection as a timeout', async () => {
    // No tab connected: the relay's own SDK_DISCONNECTED rejection, whose
    // message names `GET /tabs/wait?timeoutMs=<ms>`. The word match used to
    // read that as a timeout and replace the "open the app" suggestions.
    const relay = freshRelay();
    const handlers = createRelayHandlers(relay);

    const result = await handlers.executeElementAction!('foo', {
      action: 'click',
    } as unknown as Parameters<typeof handlers.executeElementAction>[1]);

    expect(result.error).toContain('SDK_DISCONNECTED');
    expect(result.error).toContain('timeoutMs');
    expect(result.code).not.toBe('UB-ACTION-TIMEOUT');
    expect((result as { suggestions?: string[] }).suggestions).toContain(
      'Ensure the app is open in a browser tab'
    );
  }, 10_000);

  it('does not classify a command evicted from a full queue as a timeout', async () => {
    const relay = new CommandRelay({
      globalPrefix: `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`,
      proactiveSnapshot: false,
      sseTimeoutMs: 5_000,
      maxPendingCommands: 1,
    });
    relays.push(relay);
    relay.subscribeToCommands(() => undefined, 'tab-a');
    const handlers = createRelayHandlers(relay);
    const request = { action: 'click' } as unknown as Parameters<
      typeof handlers.executeElementAction
    >[1];

    const first = handlers.executeElementAction!('foo', request);
    await new Promise((r) => setTimeout(r, 20));
    const second = handlers.executeElementAction!('bar', request);
    const result = await first;
    relay.destroy();
    await second;

    expect(result.error).toContain('Command evicted');
    expect(result.code).toBe('UB-ACTION-FAILED');
    expect(result.error).not.toContain('The browser did not respond in time');
    expect((result as { suggestions?: string[] }).suggestions?.[0]).toContain(
      'The relay dropped this command under load'
    );
  });

  it('keeps the word match for an untyped error that says timeout', async () => {
    const relay = freshRelay();
    relay.subscribeToCommands(() => undefined, 'tab-a');
    relay.queueCommand = (() => Promise.reject(new Error('upstream Timeout'))) as never;
    const handlers = createRelayHandlers(relay);

    const result = await handlers.executeElementAction!('foo', {
      action: 'click',
    } as unknown as Parameters<typeof handlers.executeElementAction>[1]);

    expect(result.code).toBe('UB-ACTION-TIMEOUT');
    expect(result.error).toContain('The browser did not respond in time');
  });
});
