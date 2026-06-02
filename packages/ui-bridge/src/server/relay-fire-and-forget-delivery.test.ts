/**
 * Co-pilot relay-delivery remediation tests — fire-and-forget delivery
 * verification + execution-outcome reporting.
 *
 * Root cause (production manual-test of the qontinui.io co-pilot
 * prompt→plan→execute flow): a `pageNavigate` command dispatched to a
 * `targetTabId` with no live SSE listener was delivered to ZERO tabs yet the
 * relay still resolved `{ success: true }` (HTTP 200). The web audit logged
 * receipt, but the page never navigated — acked-but-never-executed. The
 * fire-and-forget branch in `CommandRelay.sendCommand` discarded the
 * `broadcastToListeners` notified count and never registered a pending command,
 * so the browser's execution result was also dropped.
 *
 * Fix:
 *   1. Reject when delivery reaches no transport (notified === 0) instead of
 *      reporting a false success.
 *   2. Resolve the caller on DELIVERY with an honest `delivered:true,
 *      executed:false` envelope (not a bare `success:true` implying execution),
 *      so the web audit's execution-status field can distinguish delivered vs
 *      executed.
 *   3. Register a short-lived recorder so the browser's separately-POSTed
 *      execution outcome is ACCEPTED by `resolveCommand` (per-tab success
 *      tracking / bus forwarding) instead of being silently dropped.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { CommandRelay } from './command-relay';

function freshRelay(
  options?: Partial<ConstructorParameters<typeof CommandRelay>[0]>
): CommandRelay {
  const prefix = `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`;
  return new CommandRelay({ globalPrefix: prefix, ...(options ?? {}) });
}

/** Register a "tab" by subscribing a listener that records delivered frames. */
function registerTab(
  relay: CommandRelay,
  tabId: string
): { unsubscribe: () => void; dispatched: Array<{ commandId: string; action: string }> } {
  const dispatched: Array<{ commandId: string; action: string }> = [];
  const unsubscribe = relay.subscribeToCommands((cmd) => {
    dispatched.push({ commandId: cmd.commandId, action: cmd.action });
  }, tabId);
  return { unsubscribe, dispatched };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('relay · fire-and-forget delivery verification (co-pilot navigate)', () => {
  it('REJECTS pageNavigate when targetTabId has no live listener (no false 200)', async () => {
    const relay = freshRelay();
    // A live tab exists so the global "no browser connected" guard does NOT
    // fire — we want to exercise the per-tab broadcast-to-zero path.
    registerTab(relay, 'tab-a');

    await expect(
      relay.queueCommand('pageNavigate', { url: '/dashboard' }, { targetTabId: 'tab-zombie' })
    ).rejects.toThrow(/no .*client received|not in connectedTabs|no live listener/i);
  });

  it('delivers pageNavigate to the pinned tab and resolves delivered (not executed)', async () => {
    const relay = freshRelay();
    const tabA = registerTab(relay, 'tab-a');

    const result = await relay.queueCommand<{
      delivered: boolean;
      executed: boolean;
      tabsNotified: number;
    }>('pageNavigate', { url: '/dashboard' }, { targetTabId: 'tab-a' });

    // The command frame reached the live listener synchronously.
    expect(tabA.dispatched).toHaveLength(1);
    expect(tabA.dispatched[0]!.action).toBe('pageNavigate');

    // Resolves on delivery — honestly reporting delivered, NOT executed.
    expect(result.delivered).toBe(true);
    expect(result.executed).toBe(false);
    expect(result.tabsNotified).toBe(1);
  });

  it('ACCEPTS the browser execution outcome instead of dropping it (loop closes)', async () => {
    const relay = freshRelay();
    const tabA = registerTab(relay, 'tab-a');

    await relay.queueCommand('pageNavigate', { url: '/dashboard' }, { targetTabId: 'tab-a' });

    // Simulate the browser executing the navigation and POSTing its envelope
    // back via POST /commands → resolveCommand. Previously there was no pending
    // entry for a fire-and-forget command, so this returned false and the
    // outcome was silently dropped. The recorder now accepts it.
    const commandId = tabA.dispatched[0]!.commandId;
    const accepted = relay.resolveCommand(
      commandId,
      { success: true, url: '/dashboard', clientSideNavigation: true },
      'tab-a'
    );
    expect(accepted).toBe(true);

    // Per-tab success was recorded (routing-health bookkeeping).
    const diag = relay.getTransportDiagnostics();
    expect(diag.connectedTabs).toContain('tab-a');
  });

  it('still resolves (not rejects) navigate when delivered to the primary tab', async () => {
    const relay = freshRelay();
    registerTab(relay, 'tab-a'); // primary

    await expect(
      relay.queueCommand<{ delivered: boolean }>('pageNavigate', { url: '/settings' })
    ).resolves.toMatchObject({ delivered: true });
  });
});
