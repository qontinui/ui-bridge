/**
 * A heartbeat whose ownership claim the relay refuses leaves the tab
 * unregistered, and a scoped caller cannot reach an unregistered tab. The
 * client reports the refusal once per run of refused beats, and reopens its
 * stream only when the relay says that stream is bound to an identity the page
 * no longer has (a re-login) — the one refusal reopening can fix.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startRelayClient } from './relay-client';

/** A stream that sends its `connected` event and then stays open. */
function openStreamBody(n: number): { getReader: () => ReadableStreamDefaultReader<Uint8Array> } {
  const frame = `data: ${JSON.stringify({ type: 'connected', streamId: `stream-${n}` })}\n\n`;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frame));
    },
  });
  return { getReader: () => stream.getReader() };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

describe('relay client · refused ownership claim', () => {
  let streamOpens: number;
  let refuse: false | string;
  let errors: string[];
  let beatBodies: Array<Record<string, unknown>>;
  let stop: (() => void) | null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    streamOpens = 0;
    refuse = 'OWNER_CHANGE_UNVERIFIED';
    errors = [];
    beatBodies = [];
    stop = null;
    vi.stubGlobal('fetch', (input: unknown, init?: { body?: string }) => {
      const url = String(input);
      if (url.includes('/commands/stream')) {
        streamOpens++;
        return Promise.resolve({
          ok: true,
          body: openStreamBody(streamOpens),
        } as unknown as Response);
      }
      if (url.includes('/heartbeat')) {
        beatBodies.push(JSON.parse(init?.body ?? '{}') as Record<string, unknown>);
        const data = refuse
          ? { received: true, ownershipAssigned: false, ownerChangeRejected: refuse }
          : { received: true, tabRegistered: true };
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data }),
        } as unknown as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    });
  });

  afterEach(() => {
    stop?.();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function beat(): Promise<void> {
    await vi.advanceTimersByTimeAsync(10_000);
    await flush();
  }

  function boot(): void {
    const client = startRelayClient({
      basePath: '/api/ui-bridge',
      execute: async () => ({ success: true }),
      heartbeatIntervalMs: 10_000,
      onError: (message) => errors.push(message),
    });
    stop = () => client.stop();
  }

  it('reports once per run of refusals and does not reopen the stream for them', async () => {
    boot();
    await flush();
    await beat();
    await beat();
    expect(streamOpens).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('OWNER_CHANGE_UNVERIFIED');

    // Accepted, then refused again: a new run reports again.
    refuse = false;
    await beat();
    refuse = 'OWNER_CHANGE_UNVERIFIED';
    await beat();
    expect(errors).toHaveLength(2);
    expect(streamOpens).toBe(1);
  });

  it('names its stream on each beat, and reopens it when the relay says it is bound elsewhere', async () => {
    refuse = false;
    boot();
    await flush();
    await beat();
    expect(beatBodies.at(-1)?.streamId).toBe('stream-1');

    refuse = 'STREAM_IDENTITY_CHANGED';
    await beat();
    expect(streamOpens).toBe(2);
    refuse = false;
    await beat();
    expect(beatBodies.at(-1)?.streamId).toBe('stream-2');
  });
});
