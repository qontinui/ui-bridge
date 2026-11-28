/**
 * A relayed `TabReportedFailure` whose `failureDetails.errorCode` is canonical
 * keeps that code, with no dependence on its message (plan
 * 2026-11-21-ui-bridge-relay-follow-ups-from-434-438 Phase 2, step 4).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';

const relays: CommandRelay[] = [];

afterEach(() => {
  for (const relay of relays.splice(0)) relay.destroy();
});

describe('relayed tab failure · canonical errorCode survives', () => {
  it.each(['UB-ACTION-TIMEOUT', 'UB-ELEM-NOT-FOUND', 'UB-VALIDATION-ERROR'])(
    '%s is kept although the message names no cause',
    async (errorCode) => {
      const relay = new CommandRelay({
        globalPrefix: `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`,
        proactiveSnapshot: false,
      });
      relays.push(relay);
      relay.subscribeToCommands((cmd) => {
        setTimeout(() => {
          relay.resolveCommand(
            cmd.commandId,
            {
              success: false,
              error: 'the tab said no',
              failureDetails: { errorCode, message: 'the tab said no' },
            },
            'tab-a'
          );
        }, 0);
      }, 'tab-a');

      const result = await createRelayHandlers(relay).executeElementAction!('el', {
        action: 'click',
      });

      expect(result.success).toBe(false);
      expect(result.code).toBe(errorCode);
    }
  );
});
