/**
 * Executor `submit` / `reset` fire their form event exactly ONCE.
 *
 * `performSubmit` used to hand-dispatch a `submit` event and then call
 * `requestSubmit()`, which fires its own — so every submit handler ran twice
 * (a double POST on a real form). `performReset` did the same after
 * `form.reset()`. The React IPC relay fired each once; both paths now agree.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';

describe('DefaultActionExecutor — submit/reset event count', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;
  let form: HTMLFormElement;
  let input: HTMLInputElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
    form = document.createElement('form');
    input = document.createElement('input');
    form.appendChild(input);
    document.body.appendChild(form);
    registry.registerElement('the-form', form, { type: 'form', label: 'Form' });
  });

  afterEach(() => {
    form.remove();
  });

  it('an uncancelled submit fires one submit event', async () => {
    // The double fire showed only when NOTHING cancelled the event (a form
    // left to navigate): any `preventDefault` on the hand-dispatched event
    // made the old code skip `requestSubmit`. jsdom does not navigate — it
    // reports "not implemented" to the virtual console (an expected
    // stack trace in the test output) and returns.
    let submits = 0;
    form.addEventListener('submit', () => {
      submits += 1;
    });

    const result = await executor.executeAction('the-form', { action: 'submit' });

    expect(result.success, `submit failed: ${result.error}`).toBe(true);
    expect(submits).toBe(1);
  });

  it('a cancelling submit handler sees exactly one event (control: passed before the fix too)', async () => {
    let submits = 0;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submits += 1;
    });

    const result = await executor.executeAction('the-form', { action: 'submit' });

    expect(result.success, `submit failed: ${result.error}`).toBe(true);
    expect(submits).toBe(1);
  });

  it('reset fires one reset event and resets the form', async () => {
    input.defaultValue = 'initial';
    input.value = 'edited';
    let resets = 0;
    form.addEventListener('reset', () => {
      resets += 1;
    });

    const result = await executor.executeAction('the-form', { action: 'reset' });

    expect(result.success, `reset failed: ${result.error}`).toBe(true);
    expect(resets).toBe(1);
    expect(input.value).toBe('initial');
  });

  it('an invalid form is refused, not reported as a success with nothing submitted', async () => {
    input.name = 'email';
    input.required = true;
    let submits = 0;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submits += 1;
    });

    const result = await executor.executeAction('the-form', { action: 'submit' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('constraint validation');
    expect(result.error).toContain('email');
    expect(submits).toBe(0);
  });

  it("a submit button target is passed as the event's submitter", async () => {
    const btn = document.createElement('button');
    btn.type = 'submit';
    btn.name = 'intent';
    btn.value = 'save';
    form.appendChild(btn);
    registry.registerElement('the-button', btn, { type: 'button', label: 'Save' });
    let submitter: HTMLElement | null = null;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submitter = (e as SubmitEvent).submitter;
    });

    const result = await executor.executeAction('the-button', { action: 'submit' });

    expect(result.success, `submit failed: ${result.error}`).toBe(true);
    expect(submitter).toBe(btn);
  });
});
