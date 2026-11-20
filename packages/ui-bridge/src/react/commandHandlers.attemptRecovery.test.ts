/**
 * The generic relay's `attemptRecovery` stub states the recovery verdict.
 *
 * Plan 2026-11-18-the-journey-ledger-never-records-an-unknown-action-verdict-
 * as-a-success-or-a-failure, D4: every recovery answer states
 * `attemptSucceeded`. The relay does not implement recovery, so no strategy
 * ran and the verdict is `false`, beside the envelope's `success: false`.
 */

import { describe, expect, it } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

describe('relay attemptRecovery stub', () => {
  it('answers success: false with attemptSucceeded: false and no strategies', async () => {
    const res = (await executeCommand(
      'attemptRecovery',
      {
        failure: { errorCode: 'UB-ELEM-NOT-VISIBLE', message: 'm', retryRecommended: true },
        instruction: 'click btn',
        maxRetries: 1,
      } as never,
      emptyBridge
    )) as { success: boolean; error?: string; data?: unknown };

    expect(res.success).toBe(false);
    expect(res.error).toBe('Recovery not implemented for generic relay');
    expect(res.data).toEqual({
      attemptSucceeded: false,
      originalActionPerformed: false,
      originalActionAttempted: false,
      strategiesAttempted: [],
    });
  });
});
