/**
 * A newly connected tab gets one warm-up `getControlSnapshot` of its own,
 * unless the relay is built with `proactiveSnapshot: false` (the tests that
 * count which tab each command reached turn it off).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { CommandRelay } from './command-relay';

describe('the warm-up snapshot', () => {
  let relay: CommandRelay | undefined;
  afterEach(() => relay?.destroy());

  async function actionsSeenWithin(ms: number, options: { proactiveSnapshot?: boolean }) {
    relay = new CommandRelay({
      globalPrefix: `__uiBridgeWarmup_${Math.random().toString(36).slice(2, 10)}`,
      ...options,
    });
    const seen: string[] = [];
    relay.subscribeToCommands((command) => {
      seen.push(command.action);
      setTimeout(
        () =>
          relay!.resolveCommand(
            command.commandId,
            { elements: [{ id: 'e' }], components: [], workflows: [], timestamp: Date.now() },
            'tab-1'
          ),
        0
      );
    }, 'tab-1');
    await new Promise((resolve) => setTimeout(resolve, ms));
    return seen;
  }

  it('is sent to a tab that connects, by default', async () => {
    expect(await actionsSeenWithin(900, {})).toEqual(['getControlSnapshot']);
  });

  it('is not sent when the relay turns it off', async () => {
    expect(await actionsSeenWithin(900, { proactiveSnapshot: false })).toEqual([]);
  });
});
