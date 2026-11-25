/**
 * @vitest-environment jsdom
 */

/**
 * A recording session keeps one recorded interaction per user action.
 *
 * A checkbox toggle used to reach `RecordingSessionManager` twice from its
 * interceptor: as `check`, and as a coalesced `type` carrying the box's value
 * attribute (`"on"`). The session then derived a variable candidate from that
 * `type`. This pins the toggle, entered through `start()` and `stop()`, to one
 * `check` and no variable.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { RecordingSessionManager } from './session-manager';

describe('RecordingSessionManager', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('records a checkbox toggle as one check and derives no variable from it', async () => {
    vi.useFakeTimers();
    const registry = new UIBridgeRegistry();
    const box = document.createElement('input');
    box.type = 'checkbox';
    document.body.append(box);
    registry.registerElement('remember-me', box, { type: 'checkbox' });

    const session = new RecordingSessionManager(registry);
    session.start();
    box.click();
    // Past the interceptor's keystroke window (100 ms) and the session's settle debounce (300 ms).
    await vi.advanceTimersByTimeAsync(1000);
    const result = session.stop();

    expect(result.exportData.transitions.map((t) => t.actionType)).toEqual(['check']);
    expect(result.interactionCount).toBe(1);
    expect(result.variables).toEqual([]);
  });

  // ---- recorder name chain: what a typed input is called ------------------
  // Each case builds the DOM, types into the input through the real
  // interceptor path, and reads the stored variable's `label` and
  // `suggestedParamName`. The expectations are literals.
  async function recordTyped(html: string): Promise<{ label: string; param: string }> {
    vi.useFakeTimers();
    document.body.innerHTML = html;
    const input = document.querySelector<HTMLInputElement>('#target')!;
    const registry = new UIBridgeRegistry();
    registry.registerElement('target', input, { type: 'input' });
    const session = new RecordingSessionManager(registry);
    session.start();
    input.focus();
    input.value = 'hello';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1000);
    const result = session.stop();
    expect(result.variables).toHaveLength(1);
    const v = result.variables[0]!;
    return { label: v.label as string, param: v.suggestedParamName };
  }

  it.each([
    ['aria-label', '<input id="target" aria-label="Email address">', 'Email address', 'emailAddress'],
    ['<label for>', '<label for="target">Full name</label><input id="target">', 'Full name', 'fullName'],
    ['wrapping label', '<label>Nick <input id="target"></label>', 'Nick', 'nick'],
    ['placeholder', '<input id="target" placeholder="Search here">', 'Search here', 'searchHere'],
    ['aria-labelledby', '<span id="l1">Billing</span> <span id="l2">zip</span><input id="target" aria-labelledby="l1 l2">', 'Billing zip', 'billingZip'],
    ['title', '<input id="target" title="Promo code">', 'Promo code', 'promoCode'],
    ['data-testid only', '<input id="target" data-testid="user-field">', 'user-field', 'userfield'],
    ['name only', '<input id="target" name="zip_code">', 'zip_code', 'zipcode'],
    ['data-cy only', '<input id="target" data-cy="cy-field">', 'cy-field', 'cyfield'],
    ['nothing but an id', '<input id="target">', 'target', 'target'],
  ])('names a typed input by %s', async (_name, html, label, param) => {
    expect(await recordTyped(html)).toEqual({ label, param });
  });

  it('names a content-redacted input with the sentinel, never its label text', async () => {
    const got = await recordTyped(
      '<div data-bridge-redact="true"><input id="target" aria-label="SECRET-4111"></div>'
    );
    expect(got.label).toBe('[REDACTED]');
    expect(got.param).toBe('redacted');
  });

  it('caps a very long canonical name at 200 code points with an ellipsis', async () => {
    const long = 'x'.repeat(300);
    const got = await recordTyped(`<input id="target" aria-label="${long}">`);
    expect(got.label).toBe('x'.repeat(200) + '…');
    expect(got.param).toBe('x'.repeat(200));
  });

  it('keeps the secret out of a name labelled through a redaction boundary', async () => {
    const got = await recordTyped(
      '<span id="l1">Pay <span data-bridge-redact="true">SECRET-4111</span> now</span>' +
        '<input id="target" aria-labelledby="l1">'
    );
    expect(got.label).not.toContain('SECRET-4111');
    expect(got.param).not.toContain('secret');
    expect(got.label).toContain('[REDACTED]');
  });

  it('prefers aria-labelledby over aria-label when naming a typed input', async () => {
    const got = await recordTyped(
      '<span id="l1">Billing</span><input id="target" aria-label="Ignored" aria-labelledby="l1">'
    );
    expect(got).toEqual({ label: 'Billing', param: 'billing' });
  });

  it('prefers aria-label over a <label for> when naming a typed input', async () => {
    const got = await recordTyped(
      '<label for="target">Visible</label><input id="target" aria-label="Aria wins">'
    );
    expect(got).toEqual({ label: 'Aria wins', param: 'ariaWins' });
  });

  it('never splits a redaction sentinel that straddles the 200-code-point cap', async () => {
    const got = await recordTyped(
      '<span id="l1">' +
        'x'.repeat(195) +
        '<span data-bridge-redact="true">SECRET-4111</span> tail</span>' +
        '<input id="target" aria-labelledby="l1">'
    );
    expect(got.label).not.toContain('SECRET-4111');
    expect(got.label).not.toMatch(/\[RED(?!ACTED\])/);
    expect(got.param).not.toContain('secret');
  });
});
