/**
 * The element-action event producer (`./element-action-events.ts`): what it
 * emits around one action, and that neither a throwing action nor a throwing
 * listener changes the action's answer.
 */
import { describe, expect, it } from 'vitest';
import {
  eventResponseOf,
  recordedVerb,
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
      data: {
        elementId: 'go',
        action: 'click',
        response: {
          success: false,
          error: 'action failed (UB-ELEM-NOT-VISIBLE)',
          failureDetails: { errorCode: 'UB-ELEM-NOT-VISIBLE' },
        },
        error: 'action failed (UB-ELEM-NOT-VISIBLE)',
      },
    });
  });

  it('a success envelope over a failed action answer is a failure', async () => {
    const { sink, events } = recordingSink();
    await withElementActionEvents(sink, 'go', 'click', async () => ({
      success: true,
      data: { success: false, error: 'refused', failureDetails: { errorCode: 'UB-REFUSED' } },
    }));
    expect(events[1]).toMatchObject({
      type: 'action:failed',
      data: { error: 'action failed (UB-REFUSED)' },
    });
    expect(JSON.stringify(events)).not.toContain('refused"');
  });

  it('a failure with no code is recorded under UB-ACTION-FAILED', async () => {
    const { sink, events } = recordingSink();
    await withElementActionEvents(sink, 'go', 'click', async () => ({ success: false }));
    expect(events[1]).toMatchObject({
      type: 'action:failed',
      data: {
        error: 'action failed (UB-ACTION-FAILED)',
        response: { failureDetails: { errorCode: 'UB-ACTION-FAILED' } },
      },
    });
  });

  it('a code that is not a code token is not kept', async () => {
    const { sink, events } = recordingSink();
    await withElementActionEvents(sink, 'go', 'click', async () => ({
      success: false,
      code: 'secret-xyz is not a code',
    }));
    expect(events[1]).toMatchObject({ data: { error: 'action failed (UB-ACTION-FAILED)' } });
    expect(JSON.stringify(events)).not.toContain('secret-xyz');
  });

  it('a throw is recorded as action:failed by its code, never its message, and rethrown', async () => {
    const { sink, events } = recordingSink();
    await expect(
      withElementActionEvents(sink, 'go', 'click', async () => {
        throw Object.assign(new Error('secret-xyz'), { code: 'TERMINAL_EXITED' });
      })
    ).rejects.toThrow('secret-xyz');
    expect(events[1]).toEqual({
      type: 'action:failed',
      data: {
        elementId: 'go',
        action: 'click',
        response: {
          success: false,
          error: 'action failed (TERMINAL_EXITED)',
          failureDetails: { errorCode: 'TERMINAL_EXITED' },
          timestamp: expect.any(Number),
        },
        error: 'action failed (TERMINAL_EXITED)',
      },
    });
    expect(JSON.stringify(events)).not.toContain('secret-xyz');
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
  it('keeps the allowlisted fields and the failure code, drops the rest (all caller/app text)', () => {
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
      error: 'action failed (UB-ACTION-FAILED)',
      durationMs: 3,
      timestamp: 4,
      elementState: { visible: true },
      failureDetails: { errorCode: 'UB-ACTION-FAILED' },
    });
  });

  it("keeps only the element's non-content state", () => {
    expect(
      eventResponseOf({
        success: true,
        elementState: {
          visible: true,
          enabled: true,
          focused: true,
          checked: false,
          role: 'textbox',
          value: 'typed text',
          textContent: 'shown text',
          selectedOptions: ['opt'],
          availableOptions: [{ value: 'a', label: 'A', selected: true }],
          innerHTML: '<b>x</b>',
          accessibleName: 'Name',
          dataset: { token: 't' },
          href: '/x?token=t',
          rect: { x: 1 },
        },
      })
    ).toEqual({
      success: true,
      elementState: {
        visible: true,
        enabled: true,
        focused: true,
        checked: false,
        role: 'textbox',
      },
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
    /** A METHOD (not a getter) reading a #private field. */
    callCount(): number {
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

  it('a method reading a #private field works through the wrapper', async () => {
    const { sink } = recordingSink();
    const wrapped = recordingActionExecutor(new Executor(), sink);
    await wrapped.executeAction('go', { action: 'click' });
    await wrapped.executeAction('go', { action: 'click' });
    expect(wrapped.callCount()).toBe(2);
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('rejected secret-xyz'))],
    [
      'throws synchronously',
      () => {
        throw new Error('thrown secret-xyz');
      },
    ],
  ])(
    'an executeAction that %s: started then failed, and the error is rethrown',
    async (_n, impl) => {
      const { sink, events } = recordingSink();
      const raw = { executeAction: impl as (id: string, r: unknown) => Promise<unknown> };
      const wrapped = recordingActionExecutor(raw, sink);
      await expect(wrapped.executeAction('go', { action: 'click' })).rejects.toThrow('secret-xyz');
      expect(events.map((e) => e.type)).toEqual(['action:started', 'action:failed']);
      expect(JSON.stringify(events)).not.toContain('secret-xyz');
    }
  );
});

describe('recordedVerb', () => {
  const sink = {
    getElement: (id: string) =>
      id === 'pane' ? { customActions: { write: { id: 'write' } } } : undefined,
  };

  it.each([
    ['a built-in verb', 'go', 'click', 'click'],
    ['a custom action the element registered', 'pane', 'write', 'write'],
    ['a custom name on an element that did not register it', 'go', 'write', 'unknown'],
    ['free text', 'go', 'my s3cret token', 'unknown'],
    ['an inherited property name', 'pane', 'toString', 'unknown'],
  ])('%s', (_n, id, verb, expected) => {
    expect(recordedVerb(sink, id, verb)).toBe(expected);
  });

  it('a throwing registration lookup records "unknown"', () => {
    const throwing = {
      getElement: () => {
        throw new Error('x');
      },
    };
    expect(recordedVerb(throwing, 'go', 'write')).toBe('unknown');
  });
});
