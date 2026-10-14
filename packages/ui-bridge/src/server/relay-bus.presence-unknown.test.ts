/**
 * The Redis bus's presence read answers three ways: present, absent, or
 * unknown when Redis errors. A caller deciding whether to hold a tab must not
 * read an outage as "no stream anywhere".
 */

import { describe, it, expect } from 'vitest';
import { RedisRelayBus } from './relay-bus';

function busOver(exists: () => Promise<number>): RedisRelayBus {
  const client = { exists, on: () => {}, publish: () => {}, subscribe: () => {} };
  const Ctor = RedisRelayBus as unknown as new (pub: unknown, sub: unknown) => RedisRelayBus;
  return new Ctor(client, client);
}

describe('RedisRelayBus · isTabKnown', () => {
  it('answers present and absent from Redis', async () => {
    expect(await busOver(async () => 1).isTabKnown('tab-a')).toBe(true);
    expect(await busOver(async () => 0).isTabKnown('tab-a')).toBe(false);
  });

  it('answers unknown, not absent, when Redis errors', async () => {
    const bus = busOver(async () => {
      throw new Error('ECONNRESET');
    });
    expect(await bus.isTabKnown('tab-a')).toBeNull();
  });
});
