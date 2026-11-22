/**
 * The Redis bus's "held elsewhere" read answers three ways: another instance
 * holds the tab, none does, or unknown when Redis errors. A caller deciding
 * whether to hold a tab for its owner must not read an outage as "no stream
 * anywhere" (`CommandRelay.openCommandStream`).
 */

import { describe, it, expect } from 'vitest';
import { RedisRelayBus } from './relay-bus';

/** A bus over a client whose holder set has `live` unexpired entries, `own` being this one's score. */
function busOver(read: () => Promise<{ live: number; own: string | null }>): RedisRelayBus {
  const client = {
    zcount: async () => (await read()).live,
    zscore: async () => (await read()).own,
    on: () => {},
    publish: () => {},
    subscribe: () => {},
  };
  const Ctor = RedisRelayBus as unknown as new (pub: unknown, sub: unknown) => RedisRelayBus;
  return new Ctor(client, client);
}

describe('RedisRelayBus · holdsElsewhere', () => {
  it('answers held and not held from Redis', async () => {
    const future = String(Date.now() + 60_000);
    expect(await busOver(async () => ({ live: 1, own: null })).holdsElsewhere('tab-a')).toBe(true);
    expect(await busOver(async () => ({ live: 1, own: future })).holdsElsewhere('tab-a')).toBe(
      false
    );
    expect(await busOver(async () => ({ live: 0, own: null })).holdsElsewhere('tab-a')).toBe(false);
  });

  it('answers unknown, not "held nowhere", when Redis errors', async () => {
    const bus = busOver(async () => {
      throw new Error('ECONNRESET');
    });
    expect(await bus.holdsElsewhere('tab-a')).toBeNull();
  });
});
