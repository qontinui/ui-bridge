/**
 * Cross-instance relay routing (P0a) regression test.
 *
 * Simulates two serverless instances by constructing two `CommandRelay`s with
 * distinct `globalPrefix` (so they don't share the globalThis in-memory state)
 * but the SAME in-memory `RelayBus`. Verifies that a command dispatched from the
 * instance that does NOT hold the tab is routed — via the bus — to the instance
 * that does, and that the browser's response routes back to the originator even
 * when it lands on a third (non-originating) instance.
 *
 * This exercises the same bus contract the Redis adapter implements (which can
 * only be verified against a live multi-instance deploy).
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { CommandRelay } from './command-relay';
import type { RelayBus, RelayCommandEnvelope, RelayResponseEnvelope } from './relay-bus';
import { InMemoryBusHub } from './__fixtures__/in-memory-relay-bus';
import { NoLiveAnswer, TabReportedFailure } from './live-answer';

/** Every relay `freshRelay()` built, destroyed after each test. */
const relays: CommandRelay[] = [];

afterEach(() => {
  for (const relay of relays.splice(0)) relay.destroy();
});

/** A relay on `bus` under a fixed globalThis-key prefix, with no warm-up snapshot. */
function freshRelay(globalPrefix: string, bus: RelayBus): CommandRelay {
  const relay = new CommandRelay({ globalPrefix, bus, proactiveSnapshot: false });
  relays.push(relay);
  return relay;
}

describe('CommandRelay cross-instance routing via RelayBus (P0a)', () => {
  it('routes a command to the instance holding the tab and the response back', async () => {
    const hub = new InMemoryBusHub();
    const instA = freshRelay('__instA_test', hub.bus('A'));
    const instB = freshRelay('__instB_test', hub.bus('B'));

    // Instance B holds the SSE listener for tab-1.
    const received: RelayCommandEnvelope[] = [];
    instB.subscribeToCommands((cmd) => {
      received.push(cmd as RelayCommandEnvelope);
    }, 'tab-1');
    // subscribeToCommands registers tab-1 in the shared presence registry, so
    // instance A's routing guard (isTabKnown) will permit the bus dispatch.

    // Instance A has NO local listener for tab-1. Dispatching a (non-fire-and-
    // forget) command must route via the bus to B.
    const pending = instA.queueCommand<{ ok: boolean; value: number }>(
      'testAction',
      { n: 1 },
      { targetTabId: 'tab-1' }
    );

    // Let the synchronous bus deliver.
    await new Promise((r) => setTimeout(r, 5));
    const cmd = received.find((c) => c.action === 'testAction');
    expect(cmd, 'command should have reached instance B via the bus').toBeTruthy();

    // The browser's response POST lands on instance B (NOT the originator A).
    // B has no local pending → it must forward the response over the bus to A.
    instB.resolveCommand(cmd!.commandId, { ok: true, value: 42 }, 'tab-1');

    const result = await pending;
    expect(result).toEqual({ ok: true, value: 42 });

    hub.clear();
  });

  it('still rejects TAB_NOT_FOUND when the tab is unknown to every instance', async () => {
    const hub = new InMemoryBusHub();
    const instA = freshRelay('__instA_test2', hub.bus('A'));

    await expect(
      instA.queueCommand('testAction', {}, { targetTabId: 'ghost-tab' })
    ).rejects.toThrow(/TAB_NOT_FOUND|not in connectedTabs/);

    hub.clear();
  });
  describe('bus delivery-failure fast-fail (NOT_DELIVERED)', () => {
    it('rejects the sender at once when the holder cannot write the command', async () => {
      const hub = new InMemoryBusHub();
      const sender = freshRelay('__instA_nd1', hub.bus('A'));
      const holder = freshRelay('__instB_nd1', hub.bus('B'));
      holder.subscribeToCommands(() => false, 'tab-1'); // the stream write fails

      const started = Date.now();
      await expect(sender.queueCommand('testAction', {}, { targetTabId: 'tab-1' })).rejects.toThrow(
        /No active UI Bridge SDK client received the testAction command/
      );
      // Far below the 8 s bus timeout.
      expect(Date.now() - started).toBeLessThan(2000);
      hub.clear();
    });

    it('does not fail a command the holder wrote', async () => {
      const hub = new InMemoryBusHub();
      const sender = freshRelay('__instA_nd2', hub.bus('A'));
      const holder = freshRelay('__instB_nd2', hub.bus('B'));
      const received: RelayCommandEnvelope[] = [];
      holder.subscribeToCommands((cmd) => {
        received.push(cmd as RelayCommandEnvelope);
      }, 'tab-1');

      const pending = sender.queueCommand<{ v: number }>(
        'testAction',
        {},
        { targetTabId: 'tab-1' }
      );
      let settled = false;
      pending.then(
        () => (settled = true),
        () => (settled = true)
      );
      await new Promise((r) => setTimeout(r, 50));
      expect(settled).toBe(false);
      holder.resolveCommand(received[0].commandId, { v: 1 }, 'tab-1');
      await expect(pending).resolves.toEqual({ v: 1 });
      hub.clear();
    });

    it('stays silent when another instance holds the tab too', async () => {
      const hub = new InMemoryBusHub();
      const sender = freshRelay('__instA_nd3', hub.bus('A'));
      const failing = freshRelay('__instB_nd3', hub.bus('B'));
      const working = freshRelay('__instC_nd3', hub.bus('C'));
      failing.subscribeToCommands(() => false, 'tab-1');
      const received: RelayCommandEnvelope[] = [];
      working.subscribeToCommands((cmd) => {
        received.push(cmd as RelayCommandEnvelope);
      }, 'tab-1');

      const pending = sender.queueCommand<{ v: number }>(
        'testAction',
        {},
        { targetTabId: 'tab-1' }
      );
      await new Promise((r) => setTimeout(r, 50));
      expect(received).toHaveLength(1);
      working.resolveCommand(received[0].commandId, { v: 2 }, 'tab-1');
      await expect(pending).resolves.toEqual({ v: 2 });
      hub.clear();
    });

    it('does not fail a broadcast when one holder cannot write it', async () => {
      const hub = new InMemoryBusHub();
      const sender = freshRelay('__instA_nd4', hub.bus('A'));
      const failing = freshRelay('__instB_nd4', hub.bus('B'));
      failing.subscribeToCommands(() => false, 'tab-1');
      const replies: RelayResponseEnvelope[] = [];
      const bus = hub.bus('probe');
      const unsub = bus.subscribeResponse('bc-1', (e) => replies.push(e));
      bus.publishCommand({
        commandId: 'bc-1',
        action: 'testAction',
        payload: {},
        timestamp: Date.now(),
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(replies).toHaveLength(0);
      unsub();
      void sender;
      hub.clear();
    });
  });
});

describe('a failure a tab reports crosses instances with its verdict (plan 2026-11-08 follow-ups, Phase 2)', () => {
  it('a failure posted on instance B rejects instance A’s caller with a TabReportedFailure carrying the result', async () => {
    const hub = new InMemoryBusHub();
    const instA = freshRelay('__instA_tabfail', hub.bus('A'));
    const instB = freshRelay('__instB_tabfail', hub.bus('B'));
    const received: RelayCommandEnvelope[] = [];
    instB.subscribeToCommands((cmd) => {
      received.push(cmd as RelayCommandEnvelope);
    }, 'tab-1');

    const pending = instA.queueCommand('getElement', { id: 'x' }, { targetTabId: 'tab-1' });
    await new Promise((r) => setTimeout(r, 5));
    const cmd = received.find((c) => c.action === 'getElement');
    expect(cmd, 'command should have reached instance B via the bus').toBeTruthy();

    const posted = {
      success: false,
      error: 'Element x not found',
      failureDetails: { errorCode: 'ELEMENT_NOT_FOUND', message: 'Element x not found' },
    };
    // The browser's failure POST lands on B, which forwards it over the bus.
    instB.rejectCommand(cmd!.commandId, 'Element x not found', 'tab-1', undefined, posted);

    const error = (await pending.catch((e: unknown) => e)) as TabReportedFailure;
    expect(error).toBeInstanceOf(TabReportedFailure);
    expect(error.message).toBe('Element x not found');
    expect(error.result).toEqual(posted);
    expect(error.tabId).toBe('tab-1');
    hub.clear();
  });

  it('a holder that never answers rejects as NoLiveAnswer(unanswered) at the bus timeout', async () => {
    const hub = new InMemoryBusHub();
    const sender = new CommandRelay({
      globalPrefix: '__instA_tabfail_to',
      bus: hub.bus('A'),
      proactiveSnapshot: false,
      sseTimeoutMs: 30,
    });
    relays.push(sender);
    const holder = freshRelay('__instB_tabfail_to', hub.bus('B'));
    holder.subscribeToCommands(() => undefined, 'tab-1'); // written, never answered

    const error = (await sender
      .queueCommand('testAction', {}, { targetTabId: 'tab-1' })
      .catch((e: unknown) => e)) as NoLiveAnswer;
    expect(error).toBeInstanceOf(NoLiveAnswer);
    expect(error.reason).toBe('unanswered');
    expect(error.message).toMatch(/^Command testAction timed out after 30ms \(bus\): /);
    hub.clear();
  });

  it('a NOT_DELIVERED reply rejects as NoLiveAnswer(not_delivered), not as a tab failure', async () => {
    const hub = new InMemoryBusHub();
    const sender = freshRelay('__instA_tabfail_nd', hub.bus('A'));
    const holder = freshRelay('__instB_tabfail_nd', hub.bus('B'));
    holder.subscribeToCommands(() => false, 'tab-1'); // the stream write fails

    const error = (await sender
      .queueCommand('testAction', {}, { targetTabId: 'tab-1' })
      .catch((e: unknown) => e)) as NoLiveAnswer;
    expect(error).toBeInstanceOf(NoLiveAnswer);
    expect(error.reason).toBe('not_delivered');
    hub.clear();
  });
});

/**
 * Plan 2026-11-08-ui-bridge-relay-client-drops-refused-results-and-heartbeats-silently,
 * Phase 4 (D2): a result that lands where nothing is pending is forwarded over
 * the bus only when some instance awaits it — the command registry says so.
 */
describe('the relay forwards only a result some instance awaits (command registry)', () => {
  /** A dispatches, B holds tab-1's stream, C is any other instance. */
  function fleet(senderOptions: { sseTimeoutMs?: number } = {}) {
    const hub = new InMemoryBusHub();
    const [busA, busB, busC] = [hub.bus('A'), hub.bus('B'), hub.bus('C')];
    const a = new CommandRelay({
      globalPrefix: `__instA_registry_${Math.random().toString(36).slice(2, 8)}`,
      bus: busA,
      proactiveSnapshot: false,
      ...senderOptions,
    });
    relays.push(a);
    const b = freshRelay(`__instB_registry_${Math.random().toString(36).slice(2, 8)}`, busB);
    const c = freshRelay(`__instC_registry_${Math.random().toString(36).slice(2, 8)}`, busC);
    const received: RelayCommandEnvelope[] = [];
    b.subscribeToCommands((cmd) => {
      received.push(cmd as RelayCommandEnvelope);
    }, 'tab-1');
    return { hub, a, b, c, busA, busB, busC, received };
  }

  it('(1) a result posted on a third instance still resolves the dispatcher’s caller', async () => {
    const { a, c, received } = fleet();
    const pending = a.queueCommand<{ v: number }>('testAction', {}, { targetTabId: 'tab-1' });
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toHaveLength(1);

    const outcome = await c.resolveCommand(received[0].commandId, { v: 7 }, 'tab-1');
    expect(outcome).toBe('forwarded');
    await expect(pending).resolves.toEqual({ v: 7 });
  });

  it('(2) a result for an id no instance dispatched is not published', async () => {
    const { c, busC } = fleet();
    const publish = vi.spyOn(busC, 'publishResponse');
    const outcome = await c.resolveCommand('never-dispatched', { v: 1 }, 'tab-1');
    expect(outcome).toBe('unknown');
    expect(publish).toHaveBeenCalledTimes(0);
  });

  it('(3) a result posted after the dispatcher timed the command out is not published', async () => {
    const { a, c, busC, received } = fleet({ sseTimeoutMs: 30 });
    const error = await a
      .queueCommand('testAction', {}, { targetTabId: 'tab-1' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NoLiveAnswer);
    expect(received).toHaveLength(1);

    const publish = vi.spyOn(busC, 'publishResponse');
    const outcome = await c.resolveCommand(received[0].commandId, { late: true }, 'tab-1');
    expect(outcome).toBe('unknown');
    expect(publish).toHaveBeenCalledTimes(0);
  });

  it('(4) a failure (`success: false`) for an id no instance awaits is not published', async () => {
    const { c, busC } = fleet();
    const publish = vi.spyOn(busC, 'publishResponse');
    const outcome = await c.rejectCommand('never-dispatched', 'nope', 'tab-1');
    expect(outcome).toBe('unknown');
    expect(publish).toHaveBeenCalledTimes(0);
  });

  it('(5) a registry read that throws or answers null still forwards, and says so', async () => {
    const { c, busC } = fleet();
    const publish = vi.spyOn(busC, 'publishResponse');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      vi.spyOn(busC, 'isCommandKnown').mockRejectedValueOnce(new Error('redis down'));
      expect(await c.resolveCommand('cmd-unverified-1', { v: 1 }, 'tab-1')).toBe('forwarded');
      vi.spyOn(busC, 'isCommandKnown').mockResolvedValueOnce(null);
      expect(await c.rejectCommand('cmd-unverified-2', 'nope', 'tab-1')).toBe('forwarded');

      expect(publish.mock.calls.map(([env]) => [env.commandId, env.ok])).toEqual([
        ['cmd-unverified-1', true],
        ['cmd-unverified-2', false],
      ]);
      const lines = warn.mock.calls.map((args) => args.map(String).join(' '));
      expect(lines.filter((l) => l.includes('result_forward_unverified'))).toEqual([
        '[ui-bridge] result_forward_unverified commandId=cmd-unverified-1: the command registry could not be read; forwarding the result over the bus',
        '[ui-bridge] result_forward_unverified commandId=cmd-unverified-2: the command registry could not be read; forwarding the result over the bus',
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it('(6) with no bus and nothing pending, a result is unknown', async () => {
    const relay = new CommandRelay({
      globalPrefix: `__noBus_registry_${Math.random().toString(36).slice(2, 8)}`,
      proactiveSnapshot: false,
    });
    relays.push(relay);
    expect(await relay.resolveCommand('never-dispatched', {}, 'tab-1')).toBe('unknown');
    expect(await relay.rejectCommand('never-dispatched', 'nope', 'tab-1')).toBe('unknown');
  });

  it('(7) a refused result on a live bus delivery never reads the registry', async () => {
    const { a, b, busB, received } = fleet();
    const pending = a.queueCommand('testAction', {}, { targetTabId: 'tab-1' });
    pending.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toHaveLength(1);

    const known = vi.spyOn(busB, 'isCommandKnown');
    const publish = vi.spyOn(busB, 'publishResponse');
    // Posted by another tab than the one the command went to.
    expect(await b.resolveCommand(received[0].commandId, {}, 'tab-2', {})).toBe('refused');
    expect(await b.rejectCommand(received[0].commandId, 'x', 'tab-2', {})).toBe('refused');
    expect(known).toHaveBeenCalledTimes(0);
    expect(publish).toHaveBeenCalledTimes(0);
  });

  it('a delivery this instance holds forwards without reading the registry', async () => {
    const { a, b, busB, received } = fleet();
    const pending = a.queueCommand<{ v: number }>('testAction', {}, { targetTabId: 'tab-1' });
    await new Promise((r) => setTimeout(r, 5));
    const known = vi.spyOn(busB, 'isCommandKnown');
    expect(await b.resolveCommand(received[0].commandId, { v: 3 }, 'tab-1')).toBe('forwarded');
    expect(known).toHaveBeenCalledTimes(0);
    await expect(pending).resolves.toEqual({ v: 3 });
  });

  it('a command settled on the dispatcher is forgotten, and one awaited stays known', async () => {
    const { a, busA, received } = fleet();
    const pending = a.queueCommand('testAction', {}, { targetTabId: 'tab-1' });
    await new Promise((r) => setTimeout(r, 5));
    const id = received[0].commandId;
    expect(await busA.isCommandKnown(id)).toBe(true);
    await a.resolveCommand(id, { done: true }, 'tab-1');
    await pending;
    expect(await busA.isCommandKnown(id)).toBe(false);
  });
});

/**
 * Same plan, Phase 5 (D6): a timeout says the result never reached this
 * instance, not that the tab is unresponsive.
 */
describe('a bus timeout says no result arrived', () => {
  it('names the bus and does not invent a tab count', async () => {
    const hub = new InMemoryBusHub();
    const sender = new CommandRelay({
      globalPrefix: '__instA_d6_bus',
      bus: hub.bus('A'),
      proactiveSnapshot: false,
      sseTimeoutMs: 30,
    });
    relays.push(sender);
    const holder = freshRelay('__instB_d6_bus', hub.bus('B'));
    holder.subscribeToCommands(() => undefined, 'tab-1'); // written, never answered

    const error = (await sender
      .queueCommand('testAction', {}, { targetTabId: 'tab-1' })
      .catch((e: unknown) => e)) as NoLiveAnswer;
    expect(error).toBeInstanceOf(NoLiveAnswer);
    expect(error.reason).toBe('unanswered');
    expect(error.message).toBe(
      'Command testAction timed out after 30ms (bus): no result reached this relay instance. ' +
        'The command was published on the bus, so how many tab(s) were sent it is not known here; ' +
        'any that were may have run it; its result may have been refused (for example 429), ' +
        'lost, or posted to another instance.'
    );
  });
});
