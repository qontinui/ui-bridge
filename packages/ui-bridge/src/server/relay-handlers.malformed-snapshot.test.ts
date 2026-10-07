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

import { describe, it, expect, vi } from 'vitest';
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
  it('a second call after the tab answered an empty object does not reject', async () => {
    const relay = freshRelay();
    vi.spyOn(relay, 'queueCommand').mockResolvedValue({} as never);
    const handlers = createRelayHandlers(relay);

    const first = await handlers.getElements!();
    const second = await handlers.getElements!();

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(second.data).toEqual([]);
    // "Could not see" must not render as a fresh, healthy empty registry.
    expect(second._meta?.stale).toBe(true);
    // The other cache readers survive too.
    await expect(handlers.getComponents!()).resolves.toMatchObject({ success: true });
    await expect(handlers.getWorkflows!()).resolves.toMatchObject({ success: true });
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

    expect(snap.success).toBe(true);
    expect(Array.isArray((snap.data as { elements: unknown }).elements)).toBe(true);
    expect(snap._meta?.stale).toBe(true);
    // And the cache it left behind still serves later readers.
    await expect(handlers.getElements!()).resolves.toMatchObject({ success: true });
  });
});
