/**
 * Direct unit tests for the shared value-mutation helper.
 *
 * `applyValueMutation` is the SINGLE place every UI-Bridge value action
 * (`type`/`setValue`/`clear`/`fill`) routes through, so its event lifecycle is
 * load-bearing: focus → input → onChange → change (→ optional blur). These
 * tests pin that lifecycle and ordering directly against the helper, plus the
 * React-controlled-input fidelity (native value setter + `_valueTracker` reset
 * + direct `__reactProps$.onChange`) that the embedded-WebView fallback relies
 * on.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyValueMutation } from './value-mutation';

describe('applyValueMutation', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  /** Create an input/textarea, append it, and attach a type-recording listener. */
  function recorderFor(
    el: HTMLInputElement | HTMLTextAreaElement,
    initial = ''
  ): { events: string[] } {
    el.value = initial;
    container.appendChild(el);
    const events: string[] = [];
    for (const t of ['focus', 'input', 'change', 'blur']) {
      el.addEventListener(t, () => events.push(t));
    }
    return { events };
  }

  it("mode 'replace' fires focus before input, sets the value, and omits blur by default", () => {
    const input = document.createElement('input');
    input.type = 'text';
    const { events } = recorderFor(input);

    applyValueMutation(input, { value: 'hello', mode: 'replace' });

    // Lifecycle order: focus before input, input before change. (The helper
    // both calls native `.focus()` AND dispatches a synthetic FocusEvent, so
    // jsdom records two focus events — assert order, not exact count.)
    expect(events).toContain('focus');
    expect(events).toContain('input');
    expect(events).toContain('change');
    expect(events.indexOf('focus')).toBeLessThan(events.indexOf('input'));
    expect(events.indexOf('input')).toBeLessThan(events.indexOf('change'));
    expect(input.value).toBe('hello');
    expect(events).not.toContain('blur');
  });

  it("mode 'replace' works for a <textarea> too", () => {
    const textarea = document.createElement('textarea');
    const { events } = recorderFor(textarea);

    applyValueMutation(textarea, { value: 'multi\nline', mode: 'replace' });

    expect(events).toContain('focus');
    expect(events).toContain('input');
    expect(events).toContain('change');
    expect(events.indexOf('focus')).toBeLessThan(events.indexOf('input'));
    expect(events.indexOf('input')).toBeLessThan(events.indexOf('change'));
    expect(textarea.value).toBe('multi\nline');
    expect(events).not.toContain('blur');
  });

  it("mode 'append' appends to the existing value with focus before input", () => {
    const input = document.createElement('input');
    input.type = 'text';
    const { events } = recorderFor(input, 'foo');

    applyValueMutation(input, { value: 'bar', mode: 'append' });

    expect(input.value).toBe('foobar');
    expect(events.indexOf('focus')).toBeLessThan(events.indexOf('input'));
    expect(events).not.toContain('blur');
  });

  it("mode 'clear' empties the value, focuses before input, and emits no blur", () => {
    const input = document.createElement('input');
    input.type = 'text';
    const { events } = recorderFor(input, 'something');

    applyValueMutation(input, { value: '', mode: 'clear' });

    expect(input.value).toBe('');
    expect(events.indexOf('focus')).toBeLessThan(events.indexOf('input'));
    expect(events).not.toContain('blur');
  });

  it("mode 'clear-then-append' replaces a pre-filled value and fires two input events", () => {
    const input = document.createElement('input');
    input.type = 'text';
    const { events } = recorderFor(input, 'old text');

    applyValueMutation(input, { value: 'new', mode: 'clear-then-append' });

    // The old value is cleared first, so the final value is the appended text only.
    expect(input.value).toBe('new');
    // Focus fires before any input.
    expect(events.indexOf('focus')).toBeLessThan(events.indexOf('input'));
    // At least two input events: the clear, then the append.
    expect(events.filter((e) => e === 'input').length).toBeGreaterThanOrEqual(2);
  });

  it('blur: true ends the sequence with a blur and dispatches a blur FocusEvent', () => {
    const input = document.createElement('input');
    input.type = 'text';
    const { events } = recorderFor(input);

    let blurFocusEvent = false;
    input.addEventListener('blur', (e) => {
      if (e instanceof FocusEvent) blurFocusEvent = true;
    });

    applyValueMutation(input, { value: 'done', mode: 'replace', blur: true });

    expect(events[events.length - 1]).toBe('blur');
    expect(blurFocusEvent).toBe(true);
  });

  it('React-controlled fidelity: resets _valueTracker to the OLD value and invokes __reactProps$.onChange', () => {
    const input = document.createElement('input');
    input.type = 'text';
    recorderFor(input, 'old');

    // Simulate React's value tracker. React skips onChange unless the tracker's
    // stored value differs from the element's new value, so the helper must
    // reset it to the OLD value.
    const trackerSetValue = vi.fn();
    (input as unknown as { _valueTracker: { getValue(): string; setValue(v: string): void } })._valueTracker =
      {
        getValue: () => input.value,
        setValue: trackerSetValue,
      };

    // Simulate React 17+ storing props on the DOM node under __reactProps$<key>.
    const onChange = vi.fn();
    (input as unknown as Record<string, unknown>)['__reactProps$test'] = { onChange };

    applyValueMutation(input, { value: 'new', mode: 'replace' });

    // onChange must be invoked directly (the WebView-reliable path).
    expect(onChange).toHaveBeenCalledTimes(1);
    const evt = onChange.mock.calls[0][0] as { target: unknown };
    expect(evt.target).toBe(input);

    // The tracker must have been reset to the OLD value so React sees old !== new.
    expect(trackerSetValue).toHaveBeenCalledWith('old');
    expect(input.value).toBe('new');
  });
});
