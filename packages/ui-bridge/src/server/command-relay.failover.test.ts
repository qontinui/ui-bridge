/**
 * The relay's failover re-sends a command only when its first tab provably did
 * not run it, or, for a declared read, did not answer in time; never to the
 * tab that failed; and the reconnect retry answers with what the retry
 * produced (plan 2026-11-08-ui-bridge-relay-and-exec-mode-follow-ups-from-pr-329,
 * Phase 3, D3 and D4).
 *
 * Before it, both failover arms of `queueCommandInner` caught ANY rejection.
 * Over SSE a tab reports every failure as a rejection, so a tab's live
 * not-found was overruled by another tab's element, a `click` a tab reported
 * as failed was run again on another tab, and with one tab the demoted primary
 * was re-promoted by its own pre-demotion heartbeat and sent the command a
 * second time.
 *
 * The fake tabs here subscribe AND heartbeat: without a heartbeat the primary
 * arm's re-promotion never engages. Reads go through `createRelayHandlers`
 * (the relay as qontinui-web mounts it), writes through
 * `relay.queueCommand('click', …)`. Every case counts deliveries per tab.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRelay, OwnerMismatchError, type CommandRelayOptions } from './command-relay';
import { InMemoryBusHub } from './__fixtures__/in-memory-relay-bus';
import { NoLiveAnswer, mayFailOver } from './live-answer';
import { createRelayHandlers } from './relay-handlers';

const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);
const ID = 'save-btn';

/** The dispatcher's returned not-found for `ID`, as `createActionFailure` builds it. */
const NOT_FOUND = {
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
  timestamp: 1700000000000,
};

/** A `click` the tab ran and reported as failed. */
const CLICK_FAILED = {
  success: false,
  error: `Element ${ID} is disabled`,
  failureDetails: {
    errorCode: 'ELEMENT_DISABLED',
    message: `Element ${ID} is disabled`,
    elementId: ID,
    selectorsTried: [`registry:${ID}`],
    suggestedActions: [],
    retryRecommended: false,
    durationMs: 1,
  },
  durationMs: 1,
  timestamp: 1700000000000,
};

/**
 * What a fake tab does with a command:
 *   - `answer`: resolves it (an element for a read, a success for a write);
 *   - `fail`: reports the dispatcher's failure (`NOT_FOUND` / `CLICK_FAILED`);
 *   - `noCase`: reports the dispatcher's `Unknown command action: <action>`;
 *   - `silent`: never answers;
 *   - `refuse`: its listener accepts nothing (the write fails).
 */
type Behavior = 'answer' | 'fail' | 'noCase' | 'silent' | 'refuse';

const relays: CommandRelay[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  for (const relay of relays.splice(0)) relay.destroy();
  vi.useRealTimers();
});

function freshRelay(options: CommandRelayOptions = {}): CommandRelay {
  const relay = new CommandRelay({
    globalPrefix: `__uiBridgeFailover_${Math.random().toString(36).slice(2, 10)}`,
    proactiveSnapshot: false,
    ...options,
  });
  relays.push(relay);
  return relay;
}

/** Move the fake clock to `ms` after T0, running no timer. */
function at(ms: number): void {
  vi.setSystemTime(T0 + ms);
}

/**
 * Tabs on one relay, sharing one log of `"<tabId> <action>"` delivery
 * attempts (a refused write included). Each tab acts on a command by its
 * `behavior`, which a test may change between commands.
 */
function tabsOn(relay: CommandRelay) {
  const deliveries: string[] = [];
  function open(tabId: string, behavior: Behavior) {
    const tab = { behavior, close: () => {} };
    tab.close = relay.subscribeToCommands((command) => {
      deliveries.push(`${tabId} ${command.action}`);
      const { commandId, action } = command;
      switch (tab.behavior) {
        case 'refuse':
          return false;
        case 'silent':
          return undefined;
        case 'answer':
          void relay.resolveCommand(
            commandId,
            action === 'click'
              ? { success: true, answeredBy: tabId }
              : { id: ID, type: 'button', label: 'Save', answeredBy: tabId },
            tabId
          );
          return undefined;
        case 'fail': {
          const posted = action === 'click' ? CLICK_FAILED : NOT_FOUND;
          void relay.rejectCommand(commandId, posted.error, tabId, undefined, posted);
          return undefined;
        }
        case 'noCase': {
          const message = `Unknown command action: ${action}`;
          void relay.rejectCommand(commandId, message, tabId, undefined, {
            success: false,
            error: message,
            failureDetails: { errorCode: 'UB-UNSUPPORTED-ACTION', message, timestamp: 1 },
            durationMs: 0,
            timestamp: 1,
          });
          return undefined;
        }
      }
    }, tabId);
    return tab;
  }
  return { deliveries, open };
}

/**
 * Open `tabs` in order and heartbeat them, the last one most recently, so it
 * is first for both arms: the unscoped primary (the most recently opened tab)
 * and the owner-scoped ranking (the most recent heartbeat). Each is
 * registered to `u1`.
 */
function openTabs(
  relay: CommandRelay,
  tabs: Array<[tabId: string, behavior: Behavior]>
): ReturnType<typeof tabsOn> & { tab: Record<string, { behavior: Behavior }> } {
  const rig = tabsOn(relay);
  const tab: Record<string, { behavior: Behavior }> = {};
  tabs.forEach(([tabId, behavior], i) => {
    at(i);
    tab[tabId] = rig.open(tabId, behavior);
    relay.recordRegistration(tabId, { userId: 'u1', sessionId: `session-${tabId}` });
    relay.receiveHeartbeat(tabId);
  });
  at(tabs.length);
  return { ...rig, tab };
}

/** The two dispatch arms every case is driven through. */
const ARMS = [
  { arm: 'unscoped', context: undefined, ownerCheck: undefined },
  { arm: 'owner-scoped', context: { callerUserId: 'u1' }, ownerCheck: { userId: 'u1' } },
] as const;

/** Read `ID` through the relay's handlers, settling every timer the read arms. */
async function readElement(relay: CommandRelay, context: { callerUserId: string } | undefined) {
  const answer = createRelayHandlers(relay).getElement(ID, undefined, context);
  await vi.advanceTimersByTimeAsync(20_000);
  return answer;
}

/** The diagnostics options that scope a read to `ownerCheck`'s owner, if any. */
function scoped(ownerCheck: { userId: string } | undefined) {
  return ownerCheck ? { ownerCheck } : undefined;
}

/** Send a `click`, settling every timer it arms. Its outcome comes back unawaited, in a box. */
async function sendClick(relay: CommandRelay, ownerCheck: { userId: string } | undefined) {
  const outcome = relay.queueCommand('click', { id: ID }, ownerCheck ? { ownerCheck } : undefined);
  outcome.catch(() => undefined);
  await vi.advanceTimersByTimeAsync(20_000);
  return { outcome };
}

describe.each(ARMS)('the failover, $arm', ({ context, ownerCheck }) => {
  it('1 · one tab reports a not-found: delivered once, and the answer is UB-ELEM-NOT-FOUND', async () => {
    const relay = freshRelay();
    const { deliveries } = openTabs(relay, [['tab-a', 'fail']]);

    const answer = await readElement(relay, context);

    expect(deliveries).toEqual(['tab-a getElement']);
    expect(answer).toMatchObject({
      success: false,
      error: `Element ${ID} not found`,
      code: 'UB-ELEM-NOT-FOUND',
      data: NOT_FOUND,
    });
  });

  it("2 · A reports a not-found and B holds the id: A alone is asked, and A's not-found is the answer", async () => {
    const relay = freshRelay();
    const { deliveries } = openTabs(relay, [
      ['tab-b', 'answer'],
      ['tab-a', 'fail'],
    ]);

    const answer = await readElement(relay, context);

    expect(deliveries).toEqual(['tab-a getElement']);
    expect(answer).toMatchObject({
      success: false,
      error: `Element ${ID} not found`,
      code: 'UB-ELEM-NOT-FOUND',
      data: NOT_FOUND,
    });
  });

  it("3 · A reports a click failure: B never receives the click, and A's failure is the answer", async () => {
    const relay = freshRelay();
    const { deliveries } = openTabs(relay, [
      ['tab-b', 'answer'],
      ['tab-a', 'fail'],
    ]);

    const { outcome } = await sendClick(relay, ownerCheck);

    expect(deliveries).toEqual(['tab-a click']);
    await expect(outcome).rejects.toMatchObject({
      name: 'TabReportedFailure',
      message: `Element ${ID} is disabled`,
      tabId: 'tab-a',
      result: CLICK_FAILED,
    });
  });

  it("4 · A's listener accepts nothing: B receives it, and B's answer is the answer", async () => {
    const relay = freshRelay();
    const { deliveries } = openTabs(relay, [
      ['tab-b', 'answer'],
      ['tab-a', 'refuse'],
    ]);

    const { outcome } = await sendClick(relay, ownerCheck);

    expect(deliveries).toEqual(['tab-a click', 'tab-b click']);
    await expect(outcome).resolves.toEqual({ success: true, answeredBy: 'tab-b' });
  });

  it('4b · with one tab only, a listener that accepts nothing is not tried a second time', async () => {
    const relay = freshRelay();
    const { deliveries } = openTabs(relay, [['tab-a', 'refuse']]);

    const { outcome } = await sendClick(relay, ownerCheck);

    expect(deliveries).toEqual(['tab-a click']);
    await expect(outcome).rejects.toMatchObject({
      name: 'NoLiveAnswer',
      reason: 'not_delivered',
      message:
        'No active UI Bridge SDK client received the click command. ' +
        '1 SSE listener(s) registered but none accepted the command. ' +
        'Ensure the web app is open in a browser tab with the UI Bridge SDK loaded.',
    });
  });

  it('5 · A answers `Unknown command action: getElement`: B receives it, and its element is the answer', async () => {
    const relay = freshRelay();
    const { deliveries } = openTabs(relay, [
      ['tab-b', 'answer'],
      ['tab-a', 'noCase'],
    ]);

    const answer = await readElement(relay, context);

    expect(deliveries).toEqual(['tab-a getElement', 'tab-b getElement']);
    expect(answer).toMatchObject({
      success: true,
      data: { id: ID, type: 'button', label: 'Save', answeredBy: 'tab-b' },
    });
    expect((answer as { _meta?: unknown })._meta).toBeUndefined();
  });

  it('5b · with one tab only, its no-case answer is not sent back to it', async () => {
    const relay = freshRelay();
    const { deliveries } = openTabs(relay, [['tab-a', 'noCase']]);

    const { outcome } = await sendClick(relay, ownerCheck);

    expect(deliveries).toEqual(['tab-a click']);
    await expect(outcome).rejects.toMatchObject({
      name: 'TabReportedFailure',
      message: 'Unknown command action: click',
      tabId: 'tab-a',
    });
  });

  it('6a · A is silent on getElement, a declared read: B receives it, and its element is the answer', async () => {
    const relay = freshRelay();
    const { deliveries } = openTabs(relay, [
      ['tab-b', 'answer'],
      ['tab-a', 'silent'],
    ]);

    const answer = await readElement(relay, context);

    expect(deliveries).toEqual(['tab-a getElement', 'tab-b getElement']);
    expect(answer).toMatchObject({
      success: true,
      data: { id: ID, type: 'button', label: 'Save', answeredBy: 'tab-b' },
    });
  });

  it('6b · A is silent on click: B does NOT receive it, and the answer is the timeout', async () => {
    const relay = freshRelay();
    const { deliveries } = openTabs(relay, [
      ['tab-b', 'answer'],
      ['tab-a', 'silent'],
    ]);

    const { outcome } = await sendClick(relay, ownerCheck);

    expect(deliveries).toEqual(['tab-a click']);
    await expect(outcome).rejects.toMatchObject({
      name: 'NoLiveAnswer',
      reason: 'unanswered',
      message:
        'Command click timed out after 8000ms (SSE): no result reached this relay instance. ' +
        '1 tab(s) were sent the command and may have run it; its result may have been refused ' +
        '(for example 429), lost, or posted to another instance.',
    });

    // A was demoted, and its pre-demotion heartbeat does not undo that: the
    // reported primary and the NEXT click both go to B, on either arm.
    expect(relay.getTransportDiagnostics(scoped(ownerCheck)).primaryTabId).toBe('tab-b');
    const next = await sendClick(relay, ownerCheck);
    expect(deliveries).toEqual(['tab-a click', 'tab-b click']);
    await expect(next.outcome).resolves.toEqual({ success: true, answeredBy: 'tab-b' });
  });
});

describe('the demoted primary', () => {
  it('7 · is re-promoted only by a heartbeat stamped after its demotion', async () => {
    const relay = freshRelay();
    const { tab } = openTabs(relay, [
      ['tab-b', 'answer'],
      ['tab-a', 'silent'],
    ]);
    expect(relay.getTransportDiagnostics().primaryTabId).toBe('tab-a');

    // A times out on a click and is demoted at t = 2 + 8000 ms; the clock
    // then runs on to 20 002 ms. Its last heartbeat (1 ms) is still inside
    // the 30 s window, but it was stamped BEFORE the demotion: A stays demoted.
    await sendClick(relay, undefined);
    expect(relay.getTransportDiagnostics()).toMatchObject({
      primaryTabId: 'tab-b',
      demotedTabs: ['tab-a'],
    });

    // A heartbeat stamped after it re-promotes A.
    tab['tab-a']!.behavior = 'answer';
    at(20_003);
    relay.receiveHeartbeat('tab-a');
    expect(relay.getTransportDiagnostics().demotedTabs).toEqual([]);
  });

  it('7b · a heartbeat in the same millisecond as the demotion does not re-promote it', async () => {
    const relay = freshRelay();
    openTabs(relay, [
      ['tab-b', 'answer'],
      ['tab-a', 'silent'],
    ]);
    const sent = relay.queueCommand('click', { id: ID });
    sent.catch(() => undefined);
    // Fire the 8 s timeout; A beats in the millisecond A is demoted.
    await vi.advanceTimersByTimeAsync(8_000);
    relay.receiveHeartbeat('tab-a');
    await expect(sent).rejects.toMatchObject({ name: 'NoLiveAnswer', reason: 'unanswered' });
    expect(relay.getTransportDiagnostics().demotedTabs).toEqual(['tab-a']);
  });
});

describe('the reconnect retry', () => {
  /**
   * A relay whose only transport is a WebSocket client that has silently
   * dropped: it counts as a transport when the command starts, so the command
   * is attempted at once and answers `SDK_DISCONNECTED`; the client's close
   * then unregisters it, which closes the connection gate the retry waits on.
   */
  function disconnectedRelay() {
    const relay = freshRelay();
    relay.registerWebSocketClient({
      clientId: 'ws-gone',
      send: () => {},
      isConnected: () => false,
      close: () => {},
    });
    const sent = relay.queueCommand('click', { id: ID });
    sent.catch(() => undefined);
    relay.unregisterWebSocketClient('ws-gone');
    // The disconnected state the retry waits out: nothing left to carry it.
    expect(relay.getTransportDiagnostics()).toMatchObject({
      wsClientCount: 0,
      wsClientIds: [],
      commandListenerCount: 0,
      connectedTabs: [],
    });
    return { relay, sent };
  }

  it('8 · a tab that connects during the wait and reports a failure: that failure is the answer', async () => {
    const { relay, sent } = disconnectedRelay();
    const { deliveries, open } = tabsOn(relay);

    await vi.advanceTimersByTimeAsync(500);
    open('tab-a', 'fail');
    relay.receiveHeartbeat('tab-a');
    await vi.advanceTimersByTimeAsync(0);

    expect(deliveries).toEqual(['tab-a click']);
    await expect(sent).rejects.toMatchObject({
      name: 'TabReportedFailure',
      message: `Element ${ID} is disabled`,
      tabId: 'tab-a',
      result: CLICK_FAILED,
    });
  });

  it('8b · when no tab connects within the wait, the answer is SDK_DISCONNECTED', async () => {
    const { sent } = disconnectedRelay();

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(sent).rejects.toMatchObject({
      name: 'NoLiveAnswer',
      reason: 'not_delivered',
      message:
        'SDK_DISCONNECTED: No browser connected to receive click command. ' +
        'No WebSocket clients and no SSE listeners registered. ' +
        'Open the web app in a browser tab, or launch a headless one with ' +
        '`npx @qontinui/ui-bridge-headless --url <your-app-url>`. ' +
        'Use `GET /tabs/wait?timeoutMs=<ms>` to block until the tab registers.',
    });
  });
});

describe('the owner-scoped failover never crosses owners', () => {
  it.each([
    ['accepts nothing', 'refuse', { name: 'NoLiveAnswer', reason: 'not_delivered' }],
    [
      'answers no case',
      'noCase',
      { name: 'TabReportedFailure', message: 'Unknown command action: click' },
    ],
  ] as const)(
    "u1's only tab %s: u2's tab is never sent u1's command",
    async (_label, behavior, rejection) => {
      const relay = freshRelay();
      const { deliveries, open } = tabsOn(relay);
      open('tab-b', 'answer');
      relay.recordRegistration('tab-b', { userId: 'u2', sessionId: 'session-tab-b' });
      relay.receiveHeartbeat('tab-b');
      at(1);
      open('tab-a', behavior);
      relay.recordRegistration('tab-a', { userId: 'u1', sessionId: 'session-tab-a' });
      relay.receiveHeartbeat('tab-a');
      at(2);

      const { outcome } = await sendClick(relay, { userId: 'u1' });

      expect(deliveries).toEqual(['tab-a click']);
      await expect(outcome).rejects.toMatchObject(rejection);
    }
  );
});

describe('the owner-scoped demotion', () => {
  const owner = { userId: 'u1' };

  it('9 · a sole owned tab that timed out is still delivered the next command', async () => {
    const relay = freshRelay();
    const { deliveries, tab } = openTabs(relay, [['tab-a', 'silent']]);

    const first = await sendClick(relay, owner);
    await expect(first.outcome).rejects.toMatchObject({
      name: 'NoLiveAnswer',
      reason: 'unanswered',
    });
    expect(relay.getTransportDiagnostics({ ownerCheck: owner }).demotedTabs).toEqual(['tab-a']);

    // Demoted but never dropped: ranked last of one, so still the target.
    tab['tab-a']!.behavior = 'answer';
    const second = await sendClick(relay, owner);
    expect(deliveries).toEqual(['tab-a click', 'tab-a click']);
    await expect(second.outcome).resolves.toEqual({ success: true, answeredBy: 'tab-a' });
  });

  it('10 · is undone only by a heartbeat stamped after the demotion', async () => {
    const relay = freshRelay();
    const { deliveries, tab } = openTabs(relay, [
      ['tab-b', 'answer'],
      ['tab-a', 'silent'],
    ]);
    await sendClick(relay, owner);
    expect(relay.getTransportDiagnostics({ ownerCheck: owner })).toMatchObject({
      primaryTabId: 'tab-b',
      demotedTabs: ['tab-a'],
    });

    // A beats after its demotion: re-promoted, and the freshest tab again.
    tab['tab-a']!.behavior = 'answer';
    at(20_003);
    relay.receiveHeartbeat('tab-a');
    const after = relay.getTransportDiagnostics({ ownerCheck: owner });
    expect(after.demotedTabs).toEqual([]);
    expect(after.primaryTabId).toBe('tab-a');
    const next = await sendClick(relay, owner);
    expect(deliveries).toEqual(['tab-a click', 'tab-a click']);
    await expect(next.outcome).resolves.toEqual({ success: true, answeredBy: 'tab-a' });
  });

  it('11 · a command evicted under load demotes nothing and fails over nowhere', async () => {
    const relay = freshRelay({ maxPendingCommands: 1 });
    const { deliveries } = openTabs(relay, [
      ['tab-b', 'answer'],
      ['tab-a', 'silent'],
    ]);

    const first = relay.queueCommand('getElement', { id: ID }, { ownerCheck: owner });
    first.catch(() => undefined);
    const second = relay.queueCommand('getElement', { id: ID }, { ownerCheck: owner });
    second.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);

    await expect(first).rejects.toMatchObject({ evicted: true });
    expect(deliveries).toEqual(['tab-a getElement', 'tab-a getElement']);
    expect(relay.getTransportDiagnostics({ ownerCheck: owner })).toMatchObject({
      demotedTabs: [],
      primaryTabId: 'tab-a',
    });
  });
});

describe('a command evicted under load', () => {
  it('is not failed over, even a declared read: a re-send adds load to the full queue', async () => {
    const relay = freshRelay({ maxPendingCommands: 1 });
    const { deliveries } = openTabs(relay, [
      ['tab-b', 'answer'],
      ['tab-a', 'silent'],
    ]);

    // The first read waits on silent A; the second evicts it from the queue.
    const first = relay.queueCommand('getElement', { id: ID });
    first.catch(() => undefined);
    const second = relay.queueCommand('getElement', { id: ID });
    second.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);

    await expect(first).rejects.toMatchObject({
      name: 'NoLiveAnswer',
      reason: 'unanswered',
      evicted: true,
      message: 'Command evicted: too many pending commands',
    });
    expect(deliveries).toEqual(['tab-a getElement', 'tab-a getElement']);
  });
});

/**
 * The bus arm, classified at its seam. An unpinned command reaches the bus
 * only for a tab no local selector ranks, so the failover never sees a
 * bus-routed first attempt in a one-process rig. These drive a PINNED command
 * over a real in-memory bus to get the error the relay actually rejects with,
 * and classify it: the failover catches call `mayFailOver` on exactly that.
 */
describe('a bus-routed refusal, classified at the failover seam', () => {
  function pair() {
    const hub = new InMemoryBusHub();
    const sender = freshRelay({ bus: hub.bus('A') });
    const holder = freshRelay({ bus: hub.bus('B') });
    return { hub, sender, holder };
  }

  it('a NOT_DELIVERED reply is a NoLiveAnswer(not_delivered), which fails over', async () => {
    const { hub, sender, holder } = pair();
    holder.subscribeToCommands(() => false, 'tab-1'); // the stream write fails

    const error = await sender
      .queueCommand('click', {}, { targetTabId: 'tab-1' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NoLiveAnswer);
    expect(error).toMatchObject({ reason: 'not_delivered' });
    expect(mayFailOver('click', error)).toBe(true);
    hub.clear();
  });

  it('an OWNER_MISMATCH reply is an ownership refusal, which never fails over', async () => {
    const { hub, sender, holder } = pair();
    const seen: string[] = [];
    holder.subscribeToCommands((command) => {
      seen.push(command.action);
    }, 'tab-1');
    holder.recordRegistration('tab-1', { userId: 'u1', sessionId: 'session-tab-1' });
    holder.receiveHeartbeat('tab-1');

    const error = await sender
      .queueCommand('click', {}, { targetTabId: 'tab-1', ownerCheck: { userId: 'u2' } })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OwnerMismatchError);
    expect(seen).toEqual([]);
    expect(mayFailOver('click', error)).toBe(false);
    hub.clear();
  });
});
