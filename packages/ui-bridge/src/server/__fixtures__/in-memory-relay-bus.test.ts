/**
 * The shared in-memory bus fixture: one view's close() drops only its own
 * subscriptions, as RedisRelayBus.close does; holds and registered commands stay.
 */
import { describe, expect, it } from 'vitest';
import type { RelayCommandEnvelope, RelayResponseEnvelope } from '../relay-bus';
import { InMemoryBusHub } from './in-memory-relay-bus';

describe('InMemoryBus.close()', () => {
  it('drops only its own subscriptions; tab holds and registered commands stay', async () => {
    const hub = new InMemoryBusHub();
    const [a, b] = [hub.bus('A'), hub.bus('B')];
    const seen: string[] = [];
    a.subscribeCommands('tab-1', (e: RelayCommandEnvelope) => seen.push(`A:${e.commandId}`));
    b.subscribeCommands('tab-1', (e: RelayCommandEnvelope) => seen.push(`B:${e.commandId}`));
    a.subscribeResponse('c1', (e: RelayResponseEnvelope) => seen.push(`A-resp:${e.commandId}`));
    a.registerTab('tab-1');
    b.registerTab('tab-2');
    b.registerCommand('c2', 10);
    a.registerCommand('c4', 10);

    await a.close();

    b.publishCommand({
      commandId: 'c3',
      action: 'x',
      payload: {},
      timestamp: 0,
      targetTabId: 'tab-1',
    });
    b.publishResponse({ commandId: 'c1', ok: true });
    expect(seen).toEqual(['B:c3']);
    // Holds and registered commands are keys: they outlive a closed client.
    expect(await b.isTabKnown('tab-1')).toBe(true);
    expect(await b.isTabKnown('tab-2')).toBe(true);
    expect(await b.isCommandKnown('c2')).toBe(true);
    expect(await b.isCommandKnown('c4')).toBe(true);
  });
});
