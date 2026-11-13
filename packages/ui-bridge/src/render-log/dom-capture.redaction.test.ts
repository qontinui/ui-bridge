import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { captureDOMSnapshot } from './dom-capture';
import { REDACTED_VALUE } from '../core/redaction';

function capturedById(root: HTMLElement, id: string) {
  const snap = captureDOMSnapshot({ root, includeHidden: true });
  return snap.elements.find(
    (e) => (e as { identifier?: { htmlId?: string } }).identifier?.htmlId === id
  );
}

/**
 * §4.6 Gap B — the render-log `getElementState` is the third parallel
 * `getElementState`-shaped builder (alongside `core/registry.ts` and
 * `control/action-executor.ts`). Those two stamp the shared `elementRedaction`
 * provenance onto `state.redaction`; this one did not, so a DOM-less consumer
 * that later called `verdictFromState` on a render-log `state` would read "not
 * redacted" on both axes even for a boundary/password element. This test locks
 * the stamp in.
 *
 * Plan: plans/2026-07-20-ui-bridge-structural-redaction-enforcement.md (Layer 3 follow-on)
 */
describe('render-log capture stamps §4.6 redaction provenance', () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = `
      <div data-bridge-redact="true">
        <button id="secret-btn" aria-label="Reveal SSN">123-45-6789</button>
      </div>
      <input id="pw" type="password" value="hunter2" />
      <button id="plain">Save order</button>
    `;
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
  });

  function stateOf(id: string) {
    return capturedById(root, id)?.state;
  }

  it('stamps content+value for an element inside a data-bridge-redact boundary', () => {
    const state = stateOf('secret-btn');
    expect(state?.redaction).toEqual({ content: true, value: true });
  });

  it('stamps value-only for a password input outside any boundary', () => {
    const state = stateOf('pw');
    // Password hides its value but stays addressable (content NOT redacted).
    expect(state?.redaction).toEqual({ value: true });
  });

  it('omits the provenance field entirely for a non-redacted element', () => {
    const state = stateOf('plain');
    expect(state?.redaction).toBeUndefined();
  });
});

/**
 * §4.6 VALUE axis on the captured attribute record. `CAPTURE_ATTRIBUTES` lists
 * `value`, and react-dom mirrors a controlled input's live value into that
 * attribute, so a bare password input (VALUE-redacted, not CONTENT-redacted)
 * must not ship it. `scrubRecord` used to read only the CONTENT verdict, so
 * `attributes.value` carried the cleartext password while `state.value` was
 * scrubbed one field over.
 */
describe('render-log capture scrubs the value attribute on the VALUE axis', () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = `
      <div data-bridge-redact="true">
        <input id="boxed" type="text" value="4111-1111" title="Card" />
      </div>
      <input id="pw" type="password" value="hunter2" name="password" aria-label="Password" />
      <input id="plain-input" type="text" value="order-42" />
    `;
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
  });

  function attrsOf(id: string) {
    return capturedById(root, id)?.attributes;
  }

  it('collapses a bare password input value attribute and keeps its other attributes', () => {
    const attrs = attrsOf('pw');
    expect(attrs?.value).toBe(REDACTED_VALUE);
    // CONTENT is not redacted on a bare password field: it stays addressable.
    expect(attrs?.name).toBe('password');
    expect(attrs?.['aria-label']).toBe('Password');
    expect(attrs?.type).toBe('password');
  });

  it('collapses every attribute value inside a boundary, keeping the keys', () => {
    const attrs = attrsOf('boxed');
    expect(attrs?.value).toBe(REDACTED_VALUE);
    expect(attrs?.title).toBe(REDACTED_VALUE);
    expect(Object.keys(attrs ?? {})).toEqual(expect.arrayContaining(['value', 'title', 'type']));
  });

  it('leaves a plain input value attribute raw', () => {
    expect(attrsOf('plain-input')?.value).toBe('order-42');
  });
});
