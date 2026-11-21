/**
 * Regression: a tab that answers `getControlSnapshot` with something that is
 * not a snapshot (no `elements` / `components` / `workflows` array) must not
 * poison the relay's shared snapshot cache.
 *
 * Before the fix the answer was cached as-is, and every later handler that
 * reads the cache (`getElements`, `find`, `getComponents`, `getWorkflows`,
 * `getControlSnapshot`, `pageHealth`, ...) threw a `TypeError` on
 * `latestControlSnapshot.elements.length` — one bad answer turned every
 * subsequent call into a rejection. Now a malformed answer is handled like a
 * relay failure: it is never cached, the last good snapshot is kept, and the
 * response says it is stale. (Plan
 * `2026-10-01-ui-bridge-observation-envelope-residuals`, item 2.)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';

function freshRelay(): CommandRelay {
  const prefix = `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`;
  return new CommandRelay({ globalPrefix: prefix });
}

function goodSnapshot() {
  return {
    timestamp: Date.now(),
    elements: [{ id: 'save-button', label: 'Save', state: {} }],
    components: [{ id: 'editor' }],
    workflows: [],
    activeRuns: [],
  };
}

describe('relay handlers · a malformed snapshot is never cached', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('a second call after the tab answered an empty object does not reject', async () => {
    const relay = freshRelay();
    vi.spyOn(relay, 'queueCommand').mockResolvedValue({} as never);
    const handlers = createRelayHandlers(relay);

    const first = await handlers.getElements!();
    const second = await handlers.getElements!();

    // Corrected by plan 2026-11-08-ui-bridge-relay-and-exec-mode-follow-ups-from-pr-329
    // Phase 5 (D5): no live answer over a cache no tab ever filled is a failure,
    // never an empty success.
    // "Could not see" must not render as a fresh, healthy empty registry: with
    // no good snapshot ever cached, each answer is the malformed refusal.
    for (const res of [first, second]) {
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/malformed control snapshot/);
    }
    // The other cache readers survive too: an answer, not a rejection.
    await expect(handlers.getComponents!()).resolves.toMatchObject({ success: false });
    await expect(handlers.getWorkflows!()).resolves.toMatchObject({ success: false });
  });

  it('keeps the last good snapshot when a forced refresh answers malformed', async () => {
    const relay = freshRelay();
    const queue = vi.spyOn(relay, 'queueCommand').mockResolvedValueOnce(goodSnapshot() as never);
    const handlers = createRelayHandlers(relay);

    const primed = await handlers.getElements!();
    expect((primed.data as Array<{ id: string }>).map((e) => e.id)).toEqual(['save-button']);

    queue.mockResolvedValueOnce({ error: 'boom' } as never);
    const forced = await handlers.getElements!({ recency: 'current' });

    expect(forced.success).toBe(true);
    expect((forced.data as Array<{ id: string }>).map((e) => e.id)).toEqual(['save-button']);
    expect(forced._meta?.stale).toBe(true);
  });

  it('getControlSnapshot treats a malformed answer like a relay failure', async () => {
    const relay = freshRelay();
    vi.spyOn(relay, 'hasCommandListeners').mockReturnValue(true);
    vi.spyOn(relay, 'queueCommand').mockResolvedValue({ elements: 'nope' } as never);
    const handlers = createRelayHandlers(relay);

    const snap = await handlers.getControlSnapshot!({ recency: 'current' });

    // Corrected by plan 2026-11-08-ui-bridge-relay-and-exec-mode-follow-ups-from-pr-329
    // Phase 5 (D5): no live answer over a cache no tab ever filled is a failure,
    // never an empty success.
    expect(snap.success).toBe(false);
    expect(snap.error).toMatch(/malformed control snapshot/);
    // And later readers still answer (never a rejection).
    await expect(handlers.getElements!()).resolves.toMatchObject({ success: false });
  });

  it('a snapshot with no numeric timestamp is refused, not reported fresh', async () => {
    const relay = freshRelay();
    const noTimestamp = { ...goodSnapshot(), timestamp: undefined };
    vi.spyOn(relay, 'queueCommand').mockResolvedValue(noTimestamp as never);
    const handlers = createRelayHandlers(relay);

    const res = await handlers.getElements!();

    // Corrected by plan 2026-11-08-ui-bridge-relay-and-exec-mode-follow-ups-from-pr-329
    // Phase 5 (D5): no live answer over a cache no tab ever filled is a failure,
    // never an empty success.
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/malformed control snapshot/);
  });

  it('a pinned (per-tab) read of a malformed answer is a typed failure', async () => {
    const relay = freshRelay();
    vi.spyOn(relay, 'queueCommand').mockResolvedValue({} as never);
    const handlers = createRelayHandlers(relay);

    const elements = await handlers.getElements!({ tabId: 'tab-1', text: 'Save' });
    const components = await handlers.getComponents!({ tabId: 'tab-1' });
    const snapshot = await handlers.getControlSnapshot!({ tabId: 'tab-1' });

    expect(elements.success).toBe(false);
    expect(elements.error).toMatch(/malformed control snapshot/);
    expect(components.success).toBe(false);
    expect(components.error).toMatch(/malformed control snapshot/);
    expect(snapshot.success).toBe(false);
    expect(snapshot.error).toMatch(/malformed control snapshot/);
  });

  it('a pinned read whose tab answered nothing is a typed failure, not an empty success', async () => {
    const relay = freshRelay();
    vi.spyOn(relay, 'queueCommand').mockResolvedValue(null as never);
    const handlers = createRelayHandlers(relay);

    for (const res of [
      await handlers.getElements!({ tabId: 'tab-1' }),
      await handlers.getComponents!({ tabId: 'tab-1' }),
      await handlers.getControlSnapshot!({ tabId: 'tab-1' }),
    ]) {
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/malformed control snapshot/);
    }
  });
});
