/**
 * The element-action event producer (`./element-action-events.ts`): what it
 * emits around one action, and that neither a throwing action nor a throwing
 * listener changes the action's answer.
 */
import { describe, expect, it } from 'vitest';
import {
  eventResponseOf,
  recordingActionExecutor,
  withElementActionEvents,
  type ElementActionEventSink,
} from './element-action-events';

function recordingSink() {
  const events: Array<{ type: string; data: unknown }> = [];
  const sink: ElementActionEventSink = {
    dispatchEvent: (type, data) => {
      events.push({ type, data });
    },
  };
  return { sink, events };
}

describe('withElementActionEvents', () => {
  it('a successful answer: started, then completed with the answer as response', async () => {
    const { sink, events } = recordingSink();
    const answer = { success: true, durationMs: 1, timestamp: 2 };
    expect(await withElementActionEvents(sink, 'go', 'click', async () => answer)).toBe(answer);
    expect(events).toEqual([
      { type: 'action:started', data: { elementId: 'go', action: 'click' } },
      { type: 'action:completed', data: { elementId: 'go', action: 'click', response: answer } },
    ]);
  });

  it('an envelope: the response is its data, and its failure is the event verdict', async () => {
    const { sink, events } = recordingSink();
    const inner = { success: false, error: 'not visible' };
    await withElementActionEvents(sink, 'go', 'click', async () => ({
      success: false,
      error: 'not visible',
      code: 'UB-ELEM-NOT-VISIBLE',
      data: inner,
    }));
    expect(events[1]).toEqual({
      type: 'action:failed',
      data: { elementId: 'go', action: 'click', response: inner, error: 'not visible' },
    });
  });

  it('a success envelope over a failed action answer is a failure', async () => {
    const { sink, events } = recordingSink();
    await withElementActionEvents(sink, 'go', 'click', async () => ({
      success: true,
      data: { success: false, error: 'refused' },
    }));
    expect(events[1]).toMatchObject({ type: 'action:failed', data: { error: 'refused' } });
  });

  it('a failure with no message says so', async () => {
    const { sink, events } = recordingSink();
    await withElementActionEvents(sink, 'go', 'click', async () => ({ success: false }));
    expect(events[1]).toMatchObject({
      type: 'action:failed',
      data: { error: 'the action did not report success and supplied no error message' },
    });
  });

  it('a throw is recorded as action:failed and rethrown', async () => {
    const { sink, events } = recordingSink();
    await expect(
      withElementActionEvents(sink, 'go', 'click', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(events[1]).toEqual({
      type: 'action:failed',
      data: {
        elementId: 'go',
        action: 'click',
        response: { success: false, error: 'boom', timestamp: expect.any(Number) },
        error: 'boom',
      },
    });
  });

  it('a throwing listener, or a sink with no dispatchEvent, leaves the answer unchanged', async () => {
    const throwing: ElementActionEventSink = {
      dispatchEvent: () => {
        throw new Error('listener');
      },
    };
    expect(await withElementActionEvents(throwing, 'go', 'click', async () => 7)).toBe(7);
    expect(await withElementActionEvents({}, 'go', 'click', async () => 8)).toBe(8);
  });
});

describe('eventResponseOf — only what a scrub reached', () => {
  it('keeps the allowlisted fields and the canonical failure code, drops the rest', () => {
    expect(
      eventResponseOf({
        success: false,
        error: 'boom',
        durationMs: 3,
        timestamp: 4,
        requestId: 'r1',
        elementState: { visible: true },
        result: { token: 'app-data' },
        snapshot: { elements: [] },
        changes: { added: [] },
        handlerCode: 'TERMINAL_EXITED',
        failureDetails: { errorCode: 'UB-ACTION-FAILED', message: 'boom', context: { pid: 9 } },
      })
    ).toEqual({
      success: false,
      error: 'boom',
      durationMs: 3,
      timestamp: 4,
      requestId: 'r1',
      elementState: { visible: true },
      failureDetails: { errorCode: 'UB-ACTION-FAILED', message: 'boom' },
    });
  });

  it('a non-object answer has no response', () => {
    expect(eventResponseOf('x')).toBeUndefined();
    expect(eventResponseOf(null)).toBeUndefined();
  });
});

describe('recordingActionExecutor', () => {
  class Executor {
    #calls = 0;
    async executeAction(_id: string, _request: unknown) {
      this.#calls++;
      return { success: true, result: 'r' };
    }
    get calls() {
      return this.#calls;
    }
  }

  it('wraps executeAction once; other members read through to the executor (private state intact)', async () => {
    const { sink, events } = recordingSink();
    const raw = new Executor();
    const wrapped = recordingActionExecutor(raw, sink);
    await wrapped.executeAction('go', { action: 'click' });
    expect(wrapped.calls).toBe(1);
    expect(events.map((e) => e.type)).toEqual(['action:started', 'action:completed']);
    expect(events[1].data).toEqual({
      elementId: 'go',
      action: 'click',
      response: { success: true },
    });
  });

  it.each([[{ action: '' }], [{}], [undefined], [{ action: 3 }]])(
    'a request naming no action (%j) runs without events',
    async (request) => {
      const { sink, events } = recordingSink();
      const wrapped = recordingActionExecutor(new Executor(), sink);
      await wrapped.executeAction('go', request);
      expect(events).toEqual([]);
    }
  );
});
