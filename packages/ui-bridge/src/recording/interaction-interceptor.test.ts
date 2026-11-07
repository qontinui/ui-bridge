/**
 * @vitest-environment jsdom
 */

/**
 * The interaction interceptor under its DEFAULT configuration: the one
 * `RecordingSessionManager` builds (`session-manager.ts`, only
 * `filterUnregistered` and `keystrokeCoalesceMs` passed), which captures
 * values. Passive capture runs the same class value-blind; these tests pin
 * what a recording session still gets.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { REDACTED_VALUE } from '../core/redaction';
import { InteractionInterceptor } from './interaction-interceptor';
import type { InteractionEvent } from './types';

describe('InteractionInterceptor (default config, as RecordingSessionManager builds it)', () => {
  let registry: UIBridgeRegistry;
  let events: InteractionEvent[];
  let interceptor: InteractionInterceptor;

  /** Register a fresh `<input>` and attach it to the document. */
  const field = (id: string, type: string): HTMLInputElement => {
    const el = document.createElement('input');
    el.type = type;
    document.body.append(el);
    registry.registerElement(id, el, { type: type === 'checkbox' ? 'checkbox' : 'input' });
    return el;
  };

  /** One keystroke's worth of input: the field's value changes, then `input` fires. */
  const typeInto = (el: HTMLInputElement, value: string) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new UIBridgeRegistry();
    events = [];
    interceptor = new InteractionInterceptor(registry, (e) => events.push(e));
    interceptor.start();
  });

  afterEach(() => {
    interceptor.stop();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('records a checkbox toggle as exactly one check carrying "true", and no type', async () => {
    const box = field('remember-me', 'checkbox');

    box.click(); // the browser fires `input` and then `change` for the toggle
    await vi.advanceTimersByTimeAsync(500); // past every coalescing window

    expect(events.map((e) => ({ actionType: e.actionType, value: e.value }))).toEqual([
      { actionType: 'check', value: 'true' },
    ]);
  });

  it('coalesces a run of keystrokes in a text field into one type carrying the field value', async () => {
    const name = field('display-name', 'text');

    typeInto(name, 'a');
    typeInto(name, 'ab');
    typeInto(name, 'abc');
    await vi.advanceTimersByTimeAsync(500);

    expect(events.map((e) => ({ actionType: e.actionType, value: e.value }))).toEqual([
      { actionType: 'type', value: 'abc' },
    ]);
  });

  it("scrubs a password field's typed value before it reaches the recorded event", async () => {
    const secret = field('password', 'password');

    typeInto(secret, 'hunter2');
    await vi.advanceTimersByTimeAsync(500);

    expect(events.map((e) => ({ actionType: e.actionType, value: e.value }))).toEqual([
      { actionType: 'type', value: REDACTED_VALUE },
    ]);
  });
});
