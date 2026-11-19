/**
 * `rejectCommand` settles with a typed `TabReportedFailure` carrying what the
 * tab posted, and keeps the multi-tab settle semantics (plan
 * 2026-11-08-ui-bridge-relay-and-exec-mode-follow-ups-from-pr-329, Phase 2,
 * D2). The relay's own rejections are typed `NoLiveAnswer` with their message
 * unchanged.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { CommandRelay, type QueuedCommand } from './command-relay';
import { NoLiveAnswer, TabReportedFailure } from './live-answer';

const relays: CommandRelay[] = [];

afterEach(() => {
  for (const relay of relays.splice(0)) relay.destroy();
});

function freshRelay(
  options: { sseTimeoutMs?: number; multiTabGraceMs?: number; maxPendingCommands?: number } = {}
): CommandRelay {
  const relay = new CommandRelay({
    globalPrefix: `__uiBridgeTabFailure_${Math.random().toString(36).slice(2, 10)}`,
    proactiveSnapshot: false,
    ...options,
  });
  relays.push(relay);
  return relay;
}

const POSTED_A = { success: false, error: 'A says no', failureDetails: { errorCode: 'X' } };
const POSTED_B = { success: false, error: 'B says no', failureDetails: { errorCode: 'Y' } };

/** Subscribe `tabId`, recording every command it receives. */
function listen(relay: CommandRelay, tabId: string, into: QueuedCommand[]): void {
  relay.subscribeToCommands((command) => {
    into.push(command);
  }, tabId);
}

/**
 * Demote every listed tab, so no primary is chosen and the relay broadcasts
 * one command to all of them (`queueCommandInner`'s last arm): the state a
 * relay reaches once each tab has failed as primary, and the only route by
 * which one command is notified to two tabs.
 */
function demoteAll(relay: CommandRelay, tabIds: string[]): void {
  const demoted = (relay as unknown as { demotedTabs: Set<string> }).demotedTabs;
  for (const id of tabIds) demoted.add(id);
}

describe('rejectCommand', () => {
  it('rejects with a TabReportedFailure whose result and tabId are the posted ones', async () => {
    const relay = freshRelay();
    const seen: QueuedCommand[] = [];
    listen(relay, 'tab-a', seen);

    const pending = relay.queueCommand('getElement', { id: 'x' });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toHaveLength(1);
    relay.rejectCommand(seen[0]!.commandId, 'A says no', 'tab-a', undefined, POSTED_A);

    const error = await pending.then(
      () => undefined,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(TabReportedFailure);
    expect((error as TabReportedFailure).message).toBe('A says no');
    expect((error as TabReportedFailure).result).toBe(POSTED_A);
    expect((error as TabReportedFailure).tabId).toBe('tab-a');
  });

  it('with no posted result it is still a TabReportedFailure, with result undefined', async () => {
    const relay = freshRelay();
    const seen: QueuedCommand[] = [];
    listen(relay, 'tab-a', seen);

    const pending = relay.queueCommand('getElement', { id: 'x' });
    await new Promise((r) => setTimeout(r, 0));
    relay.rejectCommand(seen[0]!.commandId, 'A says no', 'tab-a');

    const error = (await pending.catch((e: unknown) => e)) as TabReportedFailure;
    expect(error).toBeInstanceOf(TabReportedFailure);
    expect(error.result).toBeUndefined();
  });

  it('with two notified tabs, a failure then a success inside the grace window resolves with the success', async () => {
    const relay = freshRelay();
    const seenA: QueuedCommand[] = [];
    const seenB: QueuedCommand[] = [];
    listen(relay, 'tab-a', seenA);
    listen(relay, 'tab-b', seenB);
    demoteAll(relay, ['tab-a', 'tab-b']);

    const pending = relay.queueCommand('getElement', { id: 'x' });
    await new Promise((r) => setTimeout(r, 0));
    expect(seenA).toHaveLength(1);
    expect(seenB).toHaveLength(1);
    const commandId = seenA[0]!.commandId;
    relay.rejectCommand(commandId, 'A says no', 'tab-a', undefined, POSTED_A);
    relay.resolveCommand(commandId, { id: 'x', label: 'from B' }, 'tab-b');

    await expect(pending).resolves.toEqual({ id: 'x', label: 'from B' });
  });

  it('with two notified tabs, two failures reject with the FIRST, typed', async () => {
    const relay = freshRelay();
    const seenA: QueuedCommand[] = [];
    listen(relay, 'tab-a', seenA);
    listen(relay, 'tab-b', []);
    demoteAll(relay, ['tab-a', 'tab-b']);

    const pending = relay.queueCommand('getElement', { id: 'x' });
    await new Promise((r) => setTimeout(r, 0));
    const commandId = seenA[0]!.commandId;
    relay.rejectCommand(commandId, 'A says no', 'tab-a', undefined, POSTED_A);
    relay.rejectCommand(commandId, 'B says no', 'tab-b', undefined, POSTED_B);

    const error = (await pending.catch((e: unknown) => e)) as TabReportedFailure;
    expect(error).toBeInstanceOf(TabReportedFailure);
    expect(error.message).toBe('A says no');
    expect(error.result).toBe(POSTED_A);
    expect(error.tabId).toBe('tab-a');
  });

  it('with two notified tabs, one failure and the other silent rejects with that failure at the grace deadline', async () => {
    const relay = freshRelay({ multiTabGraceMs: 30, sseTimeoutMs: 5_000 });
    const seenA: QueuedCommand[] = [];
    listen(relay, 'tab-a', seenA);
    listen(relay, 'tab-b', []);
    demoteAll(relay, ['tab-a', 'tab-b']);

    const started = Date.now();
    const pending = relay.queueCommand('getElement', { id: 'x' });
    await new Promise((r) => setTimeout(r, 0));
    relay.rejectCommand(seenA[0]!.commandId, 'A says no', 'tab-a', undefined, POSTED_A);

    const error = (await pending.catch((e: unknown) => e)) as TabReportedFailure;
    expect(error).toBeInstanceOf(TabReportedFailure);
    expect(error.result).toBe(POSTED_A);
    // Settled by the 30 ms grace timer, far inside the 5 s command timeout.
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("the relay's own rejections are NoLiveAnswer, message unchanged", () => {
  it('a command evicted under load: unanswered, the eviction text, its own cause', async () => {
    const relay = freshRelay({ maxPendingCommands: 1, sseTimeoutMs: 5_000 });
    relay.subscribeToCommands(() => undefined, 'tab-a');
    const first = relay.queueCommand('getElement', { id: 'x' }).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 0));
    void relay.queueCommand('getElement', { id: 'y' }).catch(() => undefined);

    const error = (await first) as NoLiveAnswer;
    expect(error).toBeInstanceOf(NoLiveAnswer);
    expect(error.reason).toBe('unanswered');
    expect(error.message).toBe('Command evicted: too many pending commands');
    expect(error.noAnswerCause).toBe(
      'it was evicted from the pending queue under load before a tab answered'
    );
  });

  it('no connected tab (owner-scoped): not_delivered, SDK_DISCONNECTED text', async () => {
    const relay = freshRelay();
    const error = (await relay
      .queueCommand('getElement', {}, { ownerCheck: { userId: 'alice' } })
      .catch((e: unknown) => e)) as NoLiveAnswer;
    expect(error).toBeInstanceOf(NoLiveAnswer);
    expect(error.reason).toBe('not_delivered');
    expect(error.message).toMatch(
      /^SDK_DISCONNECTED: No browser connected — no WebSocket clients and no SSE listeners\. /
    );
  });

  it('a listener that accepts nothing: not_delivered, the no-active-client text', async () => {
    const relay = freshRelay();
    relay.subscribeToCommands(() => {
      throw new Error('stream write failed');
    }, 'tab-a');
    const error = (await relay
      .queueCommand('getElement', {})
      .catch((e: unknown) => e)) as NoLiveAnswer;
    expect(error).toBeInstanceOf(NoLiveAnswer);
    expect(error.reason).toBe('not_delivered');
    expect(error.message).toMatch(
      /^No active UI Bridge SDK client received the getElement command\. /
    );
  });

  it('a silent tab: unanswered, the timed-out text', async () => {
    const relay = freshRelay({ sseTimeoutMs: 20 });
    relay.subscribeToCommands(() => undefined, 'tab-a');
    const error = (await relay
      .queueCommand('getElement', {})
      .catch((e: unknown) => e)) as NoLiveAnswer;
    expect(error).toBeInstanceOf(NoLiveAnswer);
    expect(error.reason).toBe('unanswered');
    expect(error.message).toMatch(/^Command getElement timed out after 20ms \(SSE\)\. /);
  });
});
