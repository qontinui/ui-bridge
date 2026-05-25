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
import { describe, it, expect } from 'vitest';
import { CommandRelay } from './command-relay';
import type { RelayBus, RelayCommandEnvelope, RelayResponseEnvelope } from './relay-bus';

/** Synchronous in-memory bus implementing the full RelayBus contract. */
class InMemoryBus implements RelayBus {
  private cmdByTab = new Map<string, Set<(e: RelayCommandEnvelope) => void>>();
  private broadcast = new Set<(e: RelayCommandEnvelope) => void>();
  private respByCmd = new Map<string, Set<(e: RelayResponseEnvelope) => void>>();
  private present = new Set<string>();

  publishCommand(env: RelayCommandEnvelope): void {
    if (env.targetTabId) {
      this.cmdByTab.get(env.targetTabId)?.forEach((h) => h(env));
    } else {
      this.broadcast.forEach((h) => h(env));
    }
  }
  subscribeCommands(tabId: string, handler: (e: RelayCommandEnvelope) => void): () => void {
    let set = this.cmdByTab.get(tabId);
    if (!set) this.cmdByTab.set(tabId, (set = new Set()));
    set.add(handler);
    this.broadcast.add(handler);
    return () => {
      set!.delete(handler);
      this.broadcast.delete(handler);
    };
  }
  publishResponse(env: RelayResponseEnvelope): void {
    this.respByCmd.get(env.commandId)?.forEach((h) => h(env));
  }
  subscribeResponse(commandId: string, handler: (e: RelayResponseEnvelope) => void): () => void {
    let set = this.respByCmd.get(commandId);
    if (!set) this.respByCmd.set(commandId, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  }
  registerTab(tabId: string): void {
    this.present.add(tabId);
  }
  unregisterTab(tabId: string): void {
    this.present.delete(tabId);
  }
  async isTabKnown(tabId: string): Promise<boolean> {
    return this.present.has(tabId);
  }
  async close(): Promise<void> {
    this.cmdByTab.clear();
    this.broadcast.clear();
    this.respByCmd.clear();
    this.present.clear();
  }
}

describe('CommandRelay cross-instance routing via RelayBus (P0a)', () => {
  it('routes a command to the instance holding the tab and the response back', async () => {
    const bus = new InMemoryBus();
    const instA = new CommandRelay({ globalPrefix: '__instA_test', bus });
    const instB = new CommandRelay({ globalPrefix: '__instB_test', bus });

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

    await bus.close();
  });

  it('still rejects TAB_NOT_FOUND when the tab is unknown to every instance', async () => {
    const bus = new InMemoryBus();
    const instA = new CommandRelay({ globalPrefix: '__instA_test2', bus });

    await expect(
      instA.queueCommand('testAction', {}, { targetTabId: 'ghost-tab' })
    ).rejects.toThrow(/TAB_NOT_FOUND|not in connectedTabs/);

    await bus.close();
  });
});
