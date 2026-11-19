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
import { afterEach, describe, it, expect } from 'vitest';
import { CommandRelay } from './command-relay';
import type { RelayBus, RelayCommandEnvelope, RelayResponseEnvelope } from './relay-bus';
import { NoLiveAnswer, TabReportedFailure } from './live-answer';

/**
 * Synchronous in-memory bus implementing the full RelayBus contract: one hub
 * shared by every instance, and one {@link InMemoryBus} view per instance.
 * Presence is per holder, as the Redis adapter keeps it: an instance
 * registers and unregisters only its own hold on a tab, and a tab is known
 * while any instance holds it.
 */
class InMemoryBusHub {
  readonly cmdByTab = new Map<string, Set<(e: RelayCommandEnvelope) => void>>();
  readonly broadcast = new Set<(e: RelayCommandEnvelope) => void>();
  readonly respByCmd = new Map<string, Set<(e: RelayResponseEnvelope) => void>>();
  /** Each tab's holders: the instances that registered it and have not let go. */
  readonly holders = new Map<string, Set<string>>();

  /** The bus `instance` is built with. */
  bus(instance: string): RelayBus {
    return new InMemoryBus(this, instance);
  }

  clear(): void {
    this.cmdByTab.clear();
    this.broadcast.clear();
    this.respByCmd.clear();
    this.holders.clear();
  }
}

class InMemoryBus implements RelayBus {
  constructor(
    private readonly hub: InMemoryBusHub,
    private readonly instance: string
  ) {}

  publishCommand(env: RelayCommandEnvelope): void {
    if (env.targetTabId) {
      this.hub.cmdByTab.get(env.targetTabId)?.forEach((h) => h(env));
    } else {
      this.hub.broadcast.forEach((h) => h(env));
    }
  }
  subscribeCommands(tabId: string, handler: (e: RelayCommandEnvelope) => void): () => void {
    let set = this.hub.cmdByTab.get(tabId);
    if (!set) this.hub.cmdByTab.set(tabId, (set = new Set()));
    set.add(handler);
    this.hub.broadcast.add(handler);
    return () => {
      set!.delete(handler);
      this.hub.broadcast.delete(handler);
    };
  }
  publishResponse(env: RelayResponseEnvelope): void {
    this.hub.respByCmd.get(env.commandId)?.forEach((h) => h(env));
  }
  subscribeResponse(commandId: string, handler: (e: RelayResponseEnvelope) => void): () => void {
    let set = this.hub.respByCmd.get(commandId);
    if (!set) this.hub.respByCmd.set(commandId, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  }
  registerTab(tabId: string): void {
    let holders = this.hub.holders.get(tabId);
    if (!holders) this.hub.holders.set(tabId, (holders = new Set()));
    holders.add(this.instance);
  }
  unregisterTab(tabId: string): void {
    this.hub.holders.get(tabId)?.delete(this.instance);
  }
  async isTabKnown(tabId: string): Promise<boolean> {
    return (this.hub.holders.get(tabId)?.size ?? 0) > 0;
  }
  async holdsElsewhere(tabId: string): Promise<boolean> {
    return [...(this.hub.holders.get(tabId) ?? [])].some((holder) => holder !== this.instance);
  }
  async close(): Promise<void> {
    this.hub.clear();
  }
}

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
    expect(error.message).toMatch(/^Command testAction timed out after 30ms \(bus\)\. /);
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
