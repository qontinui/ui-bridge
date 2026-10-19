/**
 * The media override over the relay: its page-side waits are fitted below
 * the relay's command timeout, so a slow swap answers with its typed result
 * (DECODE_TIMEOUT + rollback, an unverified restore) instead of a bare relay
 * timeout (plan 2026-10-13-image-generation-and-visual-judgment, Phase 18).
 */

import { describe, it, expect, vi } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';
import {
  fitMediaOverrideBudget,
  MEDIA_OVERRIDE_TRANSPORT_HEADROOM_MS,
} from '../control/media-override-budget';

function relayWith(options: { wsTimeoutMs?: number; sseTimeoutMs?: number } = {}) {
  const prefix = `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`;
  const relay = new CommandRelay({ globalPrefix: prefix, ...options });
  const queue = vi.spyOn(relay, 'queueCommand').mockResolvedValue({ success: true } as never);
  return { relay, queue, handlers: createRelayHandlers(relay) };
}

describe('fitMediaOverrideBudget', () => {
  it('fills an absent wait with one that fits, never above the 10 s default', () => {
    expect(fitMediaOverrideBudget('apply', { slotId: 's' }, 8_000)).toEqual({
      ok: true,
      payload: { slotId: 's', decodeTimeoutMs: 8_000 - MEDIA_OVERRIDE_TRANSPORT_HEADROOM_MS },
    });
    expect(fitMediaOverrideBudget('apply', {}, 30_000)).toEqual({
      ok: true,
      payload: { decodeTimeoutMs: 10_000 },
    });
    expect(fitMediaOverrideBudget('restore', {}, 10_000)).toEqual({
      ok: true,
      payload: { verifyTimeoutMs: 8_000 },
    });
  });

  it('refuses a wait that would outlive the transport, naming the budget', () => {
    const res = fitMediaOverrideBudget('apply', { decodeTimeoutMs: 7_000 }, 8_000);
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toContain('8000 ms command timeout');
    expect(fitMediaOverrideBudget('apply', { decodeTimeoutMs: 6_000 }, 8_000)).toEqual({
      ok: true,
      payload: { decodeTimeoutMs: 6_000 },
    });
  });

  it('passes a non-numeric wait through for the engine to refuse', () => {
    expect(fitMediaOverrideBudget('apply', { decodeTimeoutMs: 'x' }, 8_000)).toEqual({
      ok: true,
      payload: { decodeTimeoutMs: 'x' },
    });
  });
});

describe('relay handlers · media override budget', () => {
  it('the relay budget is the smaller of its WebSocket and SSE timeouts', () => {
    expect(relayWith().relay.commandBudgetMs).toBe(8_000);
    expect(relayWith({ wsTimeoutMs: 5_000 }).relay.commandBudgetMs).toBe(5_000);
  });

  it('an apply with no decodeTimeoutMs is sent with one that fits the relay', async () => {
    const { queue, handlers } = relayWith();
    await handlers.mediaOverride({ slotId: 'hero', src: '/c.png' });
    expect(queue).toHaveBeenCalledWith(
      'mediaOverride',
      { slotId: 'hero', src: '/c.png', decodeTimeoutMs: 6_000 },
      undefined
    );
  });

  it('an apply whose decodeTimeoutMs outlives the relay is refused before dispatch', async () => {
    const { queue, handlers } = relayWith();
    const res = await handlers.mediaOverride({
      slotId: 'hero',
      src: '/c.png',
      decodeTimeoutMs: 10_000,
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('decodeTimeoutMs 10000');
    expect(queue).not.toHaveBeenCalled();
  });

  it('a restore is sent with a verifyTimeoutMs that fits the relay', async () => {
    const { queue, handlers } = relayWith({ wsTimeoutMs: 12_000, sseTimeoutMs: 12_000 });
    await handlers.mediaOverrideRestore({ overrideId: 'mo-1' });
    expect(queue).toHaveBeenCalledWith(
      'mediaOverrideRestore',
      { overrideId: 'mo-1', verifyTimeoutMs: 10_000 },
      undefined
    );
  });
});
