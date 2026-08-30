/**
 * Regression: `POST /control/visibility` on the RELAY transport must refresh
 * the cached snapshot before reading it.
 *
 * The handler answers out of `latestControlSnapshot`, the same cache
 * `getElements` / `rankElements` / `getComponents` read — but unlike them it
 * used to read it WITHOUT calling `refreshSnapshotIfNeeded` first. Called
 * before anything else had primed the cache, it therefore answered from the
 * pristine empty snapshot and returned `verdict: "unknown_empty_registry"`
 * for a live page with a full registry.
 *
 * That ordering is the normal one for an autonomous audit: "is anything
 * covering something?" is the FIRST question such a caller asks, and it has
 * no reason to take a snapshot beforehand. The bug was found exactly that
 * way — driving a real Chromium tab through `@qontinui/ui-bridge-headless`,
 * `/control/discover` reported 23 registered elements while
 * `/control/visibility` reported 0 on the same page in the same second.
 *
 * The failure mode is why this is worth pinning: it is not an error a caller
 * notices. `unknown_empty_registry` is a legitimate verdict that reads like a
 * considered answer, so a silent regression here turns the endpoint into one
 * that always says "I could not tell" — while looking healthy.
 */

import { describe, it, expect, vi } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';

function freshRelay(): CommandRelay {
  const prefix = `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`;
  return new CommandRelay({ globalPrefix: prefix });
}

/** A snapshot in which one element is covered by another. */
function snapshotWithOcclusion() {
  return {
    timestamp: Date.now(),
    elements: [
      {
        id: 'zone-header',
        label: 'Zone 1: session-name',
        state: {
          occludedBy: 'floating-widget',
          occludedPct: 33,
          textContent: 'Zone 1: session-name',
        },
      },
      { id: 'floating-widget', label: 'Widget', state: {} },
    ],
    components: [],
    workflows: [],
  };
}

describe('relay visibility · refreshes the snapshot before reading it', () => {
  it('asks the browser for a snapshot when the cache is empty (first call)', async () => {
    const relay = freshRelay();
    const queue = vi
      .spyOn(relay, 'queueCommand')
      .mockResolvedValue(snapshotWithOcclusion() as never);
    const handlers = createRelayHandlers(relay);

    // No priming call — visibility is the very first thing asked.
    const res = await handlers.visibility!();

    expect(queue).toHaveBeenCalledWith('getControlSnapshot', {});
    expect(res.success).toBe(true);
    const data = res.data as { verdict: string; elementCount: number };
    expect(data.verdict).toBe('occlusions_found');
    expect(data.elementCount).toBe(2);
  });

  it('does not report unknown_empty_registry when the page has elements', async () => {
    const relay = freshRelay();
    vi.spyOn(relay, 'queueCommand').mockResolvedValue(snapshotWithOcclusion() as never);
    const handlers = createRelayHandlers(relay);

    const res = await handlers.visibility!();

    expect((res.data as { verdict: string }).verdict).not.toBe('unknown_empty_registry');
  });

  it('still reports unknown_empty_registry when the page genuinely has no elements', async () => {
    const relay = freshRelay();
    vi.spyOn(relay, 'queueCommand').mockResolvedValue({
      timestamp: Date.now(),
      elements: [],
      components: [],
      workflows: [],
    } as never);
    const handlers = createRelayHandlers(relay);

    const res = await handlers.visibility!();

    // UNKNOWN is still UNKNOWN — the fix must not turn an empty page into a PASS.
    expect((res.data as { verdict: string }).verdict).toBe('unknown_empty_registry');
  });

  it('leaves the verdict UNKNOWN rather than PASS when the refresh itself fails', async () => {
    const relay = freshRelay();
    vi.spyOn(relay, 'queueCommand').mockRejectedValue(new Error('no browser connected'));
    const handlers = createRelayHandlers(relay);

    const res = await handlers.visibility!();

    // A failed refresh must not be reported as "clear" — there is nothing to
    // be clear ABOUT.
    expect((res.data as { verdict: string }).verdict).toBe('unknown_empty_registry');
  });
});
