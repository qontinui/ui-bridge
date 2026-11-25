/**
 * The dispatcher's bare throws name their cause with a `code`, and the relay
 * client turns that into a canonical `UB-*` `failureDetails.errorCode`.
 *
 * Messages are pinned byte for byte: the relay's no-case failover
 * (`server/live-answer.ts` `mayFailOver`) keys on the
 * `Unknown command action: <action>` prefix, so the codes were added without
 * touching them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';
import { startRelayClient } from '../relay/relay-client';
import { TabReportedFailure, mayFailOver } from '../server/live-answer';
import { EMPTY_WAIT_PREDICATE_MESSAGE } from '../core/wait-predicate';
import { codeOfThrown } from '../diagnostics';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

async function thrownBy(action: string, payload: Record<string, unknown>): Promise<unknown> {
  try {
    await executeCommand(action, payload, emptyBridge);
  } catch (e) {
    return e;
  }
  throw new Error(`${action} did not throw`);
}

const CASES: ReadonlyArray<{
  label: string;
  action: string;
  payload: Record<string, unknown>;
  message: string;
  code: string;
}> = [
  {
    label: 'an unknown action',
    action: 'noSuchAction',
    payload: {},
    message: 'Unknown command action: noSuchAction',
    code: 'UB-UNSUPPORTED-ACTION',
  },
  {
    label: 'a read of an unregistered element',
    action: 'getElementState',
    payload: { id: 'nope' },
    message: 'Element nope not found',
    code: 'UB-ELEM-NOT-FOUND',
  },
  {
    label: 'an empty wait predicate',
    action: 'waitForElementRegistered',
    payload: { predicate: {} },
    message: EMPTY_WAIT_PREDICATE_MESSAGE,
    code: 'UB-VALIDATION-ERROR',
  },
];

describe('dispatcher throws · literal message and canonical code', () => {
  it.each(CASES)('$label', async ({ action, payload, message, code }) => {
    const e = await thrownBy(action, payload);
    expect((e as Error).message).toBe(message);
    expect(codeOfThrown(e)).toBe(code);
  });

  it('the no-case message still lets the relay fail over to another tab', async () => {
    const e = await thrownBy('noSuchAction', {});
    const reported = new TabReportedFailure((e as Error).message, undefined, 'tab-a');
    expect(mayFailOver('noSuchAction', reported)).toBe(true);
    // ... and only for THIS action: another action's no-case is that tab's failure.
    expect(mayFailOver('otherAction', reported)).toBe(false);
  });
});

describe('relay client thrown-error arm · canonical code over the wire', () => {
  type Posted = {
    result?: { error?: string; failureDetails?: { errorCode?: string; message?: string } };
  };
  let posted: Posted[];
  let stop: (() => void) | null;

  beforeEach(() => {
    posted = [];
    stop = null;
  });

  afterEach(() => {
    stop?.();
    vi.unstubAllGlobals();
  });

  /** Deliver one command to a relay client whose `execute` is `execute`; return what it posted. */
  async function relayed(execute: () => Promise<unknown>): Promise<Posted> {
    vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/commands/stream')) {
        const frame = `data: ${JSON.stringify({ commandId: 'c1', action: 'x', payload: {} })}\n\n`;
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode(frame));
          },
        });
        return new Response(body, { status: 200 });
      }
      if (url.endsWith('/commands') && init?.method === 'POST') {
        posted.push(JSON.parse(String(init.body)) as Posted);
      }
      return new Response(JSON.stringify({ tabRegistered: true }), { status: 200 });
    });
    const client = startRelayClient({
      basePath: 'http://127.0.0.1:9876/ui-bridge',
      execute,
      tabId: 't1',
    });
    stop = () => client.stop();
    await vi.waitFor(() => expect(posted.length).toBe(1));
    return posted[0];
  }

  it.each(CASES)('the real dispatcher: $label', async ({ action, payload, message, code }) => {
    const out = await relayed(() => executeCommand(action, payload, emptyBridge));
    expect(out.result?.error).toBe(message);
    expect(out.result?.failureDetails?.errorCode).toBe(code);
    expect(out.result?.failureDetails?.message).toBe(message);
  });

  it('a reworded message keeps its code', async () => {
    const out = await relayed(async () => {
      throw Object.assign(new Error('the thing is gone'), { code: 'ELEMENT_NOT_FOUND' });
    });
    expect(out.result?.failureDetails?.errorCode).toBe('UB-ELEM-NOT-FOUND');
  });

  it('a message that merely reads like a cause is not classified by it', async () => {
    const out = await relayed(async () => {
      throw new Error('element not found after timeout; Unknown command');
    });
    expect(out.result?.failureDetails?.errorCode).toBe('UB-UNKNOWN-ERROR');
  });

  it('a thrown fetch failure stays UB-NET-ERROR', async () => {
    const out = await relayed(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(out.result?.failureDetails?.errorCode).toBe('UB-NET-ERROR');
  });
});
