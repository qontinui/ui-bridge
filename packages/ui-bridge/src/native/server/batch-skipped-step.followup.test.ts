/**
 * A skipped batch step must be a whole `NativeActionResponse`.
 *
 * Post-merge follow-up to qontinui/ui-bridge#164, found by the type gate that
 * PR's plan (`2026-08-20-ui-bridge-action-declaration-shape`) left open:
 * `tsconfig.native.json`. `NativeServerHandlers.executeBatchAction` declares
 * every `results[].response` as a `NativeActionResponse` — which requires
 * `durationMs` and `timestamp` — but the stop-on-failure branch pushed a bare
 * `{ success: false, error }`. A typed client reading
 * `results[i].response.durationMs` off a skipped entry got `undefined` where
 * its own types promised a number, and nothing could see it because this
 * subtree was excluded from every tsconfig in the package.
 *
 * Every expectation is a hand-written literal.
 */

import { describe, it, expect } from 'vitest';
import { createServerHandlers } from './handlers';
import { NativeUIBridgeRegistry } from '../core/registry';

function failingExecutor() {
  return {
    executeAction: async () => ({
      success: false,
      error: 'boom',
      durationMs: 7,
      timestamp: 1_700_000_000_000,
    }),
    executeComponentAction: async () => ({ success: true, durationMs: 0, timestamp: 0 }),
  };
}

function handlers() {
  return createServerHandlers(new NativeUIBridgeRegistry(), failingExecutor() as never);
}

describe('executeBatchAction skipped steps', () => {
  it('gives a skipped step the timing fields its declared type requires', async () => {
    const response = (await handlers().executeBatchAction({
      params: {},
      query: {},
      body: {
        steps: [
          { elementId: 'a', action: { action: 'click' } },
          { elementId: 'b', action: { action: 'click' } },
        ],
        stopOnFailure: true,
      },
    } as never)) as {
      data: {
        results: Array<{
          index: number;
          elementId: string;
          response: { success: boolean; error?: string; durationMs: number; timestamp: number };
        }>;
        succeededCount: number;
        failedCount: number;
        skippedCount: number;
      };
    };

    const { results } = response.data;
    expect(results).toHaveLength(2);

    // Step 0 ran and failed, so the batch stops.
    expect(results[0].response.success).toBe(false);
    expect(results[0].response.durationMs).toBe(7);

    // Step 1 never ran. It is still a complete response.
    const skipped = results[1];
    expect(skipped.index).toBe(1);
    expect(skipped.elementId).toBe('b');
    expect(skipped.response.success).toBe(false);
    expect(skipped.response.error).toBe('Skipped (previous step failed)');
    // Zero elapsed is the truth for a step that never ran -- and it is a
    // number, which is what the declared type has always claimed.
    expect(skipped.response.durationMs).toBe(0);
    expect(typeof skipped.response.timestamp).toBe('number');

    expect(response.data.succeededCount).toBe(0);
    expect(response.data.failedCount).toBe(1);
    expect(response.data.skippedCount).toBe(1);
  });
});
