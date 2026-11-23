/**
 * The relay's `controlBatch` (plan 2026-11-08-relayed-ui-bridge-actions-have-no-browser-case,
 * Phase 1, D2): the body reaches the tab as sent, and the page's batch verdict
 * IS the envelope's verdict — a failed batch is a failure envelope that keeps
 * every step result under `data`.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';
import type { ControlBatchRequest, ControlBatchResponse } from '../control/control-batch';

const relays: CommandRelay[] = [];

afterEach(() => {
  for (const relay of relays.splice(0)) relay.destroy();
});

function freshRelay(): CommandRelay {
  const prefix = `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`;
  const relay = new CommandRelay({ globalPrefix: prefix, proactiveSnapshot: false });
  relays.push(relay);
  return relay;
}

/** A tab answering every command with `answer`, recording what it was sent. */
function tab(relay: CommandRelay, answer: unknown) {
  const seen: Array<{ action: string; payload: unknown }> = [];
  relay.subscribeToCommands((cmd) => {
    seen.push({ action: cmd.action, payload: cmd.payload });
    setTimeout(() => relay.resolveCommand(cmd.commandId, answer, 'tab-a'), 0);
  }, 'tab-a');
  return seen;
}

const REQUEST: ControlBatchRequest = {
  steps: [
    { type: 'action', element_id: 'dom-go', action: 'click', label: 'press' },
    { type: 'wait', ms: 10 },
    { type: 'snapshot' },
  ],
  stopOnFailure: false,
};

const SUCCEEDED: ControlBatchResponse = {
  success: true,
  results: [
    {
      index: 0,
      type: 'action',
      label: 'press',
      success: true,
      durationMs: 2,
      data: { success: true },
    },
    { index: 1, type: 'wait', success: true, durationMs: 10, data: { waited_ms: 10 } },
    { index: 2, type: 'snapshot', success: true, durationMs: 1, data: { elements: [] } },
  ],
  completed: 3,
  total: 3,
  succeededCount: 3,
  failedCount: 0,
  skippedCount: 0,
  durationMs: 13,
};

const FAILED: ControlBatchResponse = {
  success: false,
  results: [
    {
      index: 0,
      type: 'action',
      label: 'press',
      success: false,
      durationMs: 2,
      data: {
        success: false,
        error: 'Element dom-go not found',
        failureDetails: { errorCode: 'ELEMENT_NOT_FOUND' },
      },
      error: 'Element dom-go not found',
      code: 'UB-ELEM-NOT-FOUND',
    },
  ],
  completed: 1,
  total: 3,
  succeededCount: 0,
  failedCount: 1,
  skippedCount: 2,
  durationMs: 2,
  error:
    'controlBatch: 1 of 3 steps failed (first: step 0 (action): Element dom-go not found); 2 skipped after it (stop_on_error)',
  code: 'UB-ELEM-NOT-FOUND',
};

describe('relay controlBatch', () => {
  it('forwards the body as given, under the controlBatch action', async () => {
    const relay = freshRelay();
    const seen = tab(relay, SUCCEEDED);
    await createRelayHandlers(relay).controlBatch(REQUEST);
    expect(seen).toEqual([{ action: 'controlBatch', payload: REQUEST }]);
  });

  it("a succeeded batch is the envelope's data", async () => {
    const relay = freshRelay();
    tab(relay, SUCCEEDED);
    const result = await createRelayHandlers(relay).controlBatch(REQUEST);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(SUCCEEDED);
  });

  it('an inner success: false becomes the failure envelope, with data.results kept', async () => {
    const relay = freshRelay();
    tab(relay, FAILED);
    const result = await createRelayHandlers(relay).controlBatch(REQUEST);
    expect(result.success).toBe(false);
    expect(result.error).toBe(FAILED.error);
    expect(result.code).toBe('UB-ELEM-NOT-FOUND');
    expect(result.data).toEqual(FAILED);
    expect((result.data as ControlBatchResponse).results).toEqual(FAILED.results);
  });
});
