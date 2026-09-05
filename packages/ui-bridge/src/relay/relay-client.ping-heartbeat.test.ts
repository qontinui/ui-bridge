/**
 * Follow-up to the transport-liveness fix: the heartbeat must survive the
 * browser's background-tab timer clamp.
 *
 * The relay no longer DESTROYS a hidden tab's transport when its heartbeat
 * goes stale (`zombieTransportMs`, see `server/command-relay.ts`), so a
 * throttled beat is no longer fatal. But it is still degraded: while the beat
 * is ~1/min, `staleHeartbeatMs` keeps reporting the tab inactive, so
 * `activeTabs` / `isAppResponsive` / `isTabActive` all read false for a tab
 * that is working perfectly. Freshness stops meaning anything.
 *
 * The fix is to stop depending on a clock the browser is allowed to stop.
 * `setInterval` is throttled in hidden tabs; ARRIVING BYTES are not. The
 * server's command-stream keep-alive is now a named `ping` event carrying a
 * data payload, and the client beats in response to it. The `setInterval`
 * stays as a floor for the case where no stream is attached.
 *
 * These tests model the throttled tab exactly: fake timers let `Date.now()`
 * advance via `setSystemTime` WITHOUT running the timer queue, so the
 * `setInterval` provably never fires. Any heartbeat observed therefore came
 * from the ping path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startRelayClient, parseSSEDataBlock } from './relay-client';

/** A stream we can push SSE frames into by hand. */
function controllableStream(): {
  body: { getReader: () => ReadableStreamDefaultReader<Uint8Array> };
  push: (frame: string) => void;
} {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    body: { getReader: () => stream.getReader() },
    push: (frame: string) => controller.enqueue(new TextEncoder().encode(frame)),
  };
}

function pingFrame(): string {
  return `event: ping\ndata: ${JSON.stringify({ type: 'ping', timestamp: Date.now() })}\n\n`;
}

/** Let the client's promise chain (stream read -> beat) settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

describe('relay client · ping-driven heartbeat (throttle-immune)', () => {
  let heartbeats: number;
  let stop: (() => void) | null;
  let stream: ReturnType<typeof controllableStream>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    heartbeats = 0;
    stop = null;
    stream = controllableStream();

    vi.stubGlobal('fetch', (input: unknown) => {
      const url = String(input);
      if (url.includes('/commands/stream')) {
        return Promise.resolve({ ok: true, body: stream.body } as unknown as Response);
      }
      if (url.includes('/heartbeat')) {
        heartbeats++;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ tabRegistered: true }),
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

  async function boot(): Promise<void> {
    const client = startRelayClient({
      basePath: '/api/ui-bridge',
      execute: async () => ({ success: true }),
      heartbeatIntervalMs: 10_000,
      onError: () => {},
    });
    stop = () => client.stop();
    await flush();
  }

  it('beats in response to a server ping while the timer never fires', async () => {
    await boot();
    const afterBoot = heartbeats;
    expect(afterBoot).toBeGreaterThan(0); // the boot beat

    // A backgrounded tab: wall-clock moves well past the interval, but the
    // timer queue is never run — exactly what intensive throttling produces.
    vi.setSystemTime(new Date('2026-01-01T00:00:45Z'));
    expect(heartbeats).toBe(afterBoot); // proves setInterval did NOT fire

    stream.push(pingFrame());
    await flush();

    expect(heartbeats).toBe(afterBoot + 1);
  });

  it('keeps beating across successive pings, so the tab never goes stale', async () => {
    await boot();
    const afterBoot = heartbeats;

    // Three server keep-alives at the 15s cadence, no timer firings at all.
    for (let i = 1; i <= 3; i++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, 15 * i)));
      stream.push(pingFrame());
      await flush();
    }

    expect(heartbeats).toBe(afterBoot + 3);
  });

  it('collapses pings that arrive inside one interval to a single beat', async () => {
    await boot();
    const afterBoot = heartbeats;

    vi.setSystemTime(new Date('2026-01-01T00:00:20Z'));
    stream.push(pingFrame());
    await flush();
    expect(heartbeats).toBe(afterBoot + 1);

    // +1s — inside heartbeatInterval, must not produce a second POST.
    vi.setSystemTime(new Date('2026-01-01T00:00:21Z'));
    stream.push(pingFrame());
    await flush();
    expect(heartbeats).toBe(afterBoot + 1);
  });

  it('does not treat a ping as a command', async () => {
    const executed: string[] = [];
    const client = startRelayClient({
      basePath: '/api/ui-bridge',
      execute: async (action: string) => {
        executed.push(action);
        return { success: true };
      },
      heartbeatIntervalMs: 10_000,
      onError: () => {},
    });
    stop = () => client.stop();
    await flush();

    vi.setSystemTime(new Date('2026-01-01T00:00:30Z'));
    stream.push(pingFrame());
    await flush();

    expect(executed).toEqual([]);
  });
});

describe('relay client · ping frame stays wire-compatible', () => {
  it('parses as a data block, so an older client reads it rather than choking', () => {
    const data = parseSSEDataBlock(
      `event: ping\ndata: ${JSON.stringify({ type: 'ping', timestamp: 1 })}`
    );

    expect(data).not.toBeNull();
    const parsed = JSON.parse(data!);
    // An older client's dispatch is `type === 'connected'` then
    // `commandId && action`. A ping matches neither, so it is ignored.
    expect(parsed.type).toBe('ping');
    expect(parsed.commandId).toBeUndefined();
    expect(parsed.action).toBeUndefined();
  });
});
