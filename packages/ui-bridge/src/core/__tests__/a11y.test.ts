/**
 * Stream-A A.5 — structural-accessibility populate helpers.
 *
 * These tests assert the canonical wire fields the SDK emits on every
 * `UIBridgeElement`: `role`, `tagName`, `ariaLabel`, `accessibleName`,
 * `text`. Spec-Check's matcher (Plan 02) consumes these directly and
 * must read identical values to whatever the runner serializes.
 *
 * Implementation lives in `../a11y.ts` (helpers) and `../registry.ts`
 * (`serializeRegisteredElement` populates from the live DOM node).
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  computeAriaLabel,
  computeAccessibleNameSafe,
  computeRoleSafe,
  computeVisibleText,
} from '../a11y';
import { getGlobalRegistry, resetGlobalRegistry } from '../registry';

describe('computeRoleSafe', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.removeChild(container);
  });

  it('returns explicit role when set', () => {
    const el = document.createElement('div');
    el.setAttribute('role', 'tab');
    container.appendChild(el);
    expect(computeRoleSafe(el)).toBe('tab');
  });

  it('resolves implicit role for <button>', () => {
    const el = document.createElement('button');
    container.appendChild(el);
    expect(computeRoleSafe(el)).toBe('button');
  });

  it('resolves implicit role for <input type="checkbox">', () => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    container.appendChild(el);
    expect(computeRoleSafe(el)).toBe('checkbox');
  });

  it('returns undefined for a generic <div>', () => {
    const el = document.createElement('div');
    container.appendChild(el);
    expect(computeRoleSafe(el)).toBeUndefined();
  });
});

describe('computeAriaLabel', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.removeChild(container);
  });

  it('returns explicit aria-label', () => {
    const el = document.createElement('button');
    el.setAttribute('aria-label', 'Close dialog');
    container.appendChild(el);
    expect(computeAriaLabel(el)).toBe('Close dialog');
  });

  it('falls back to aria-labelledby (single id)', () => {
    const label = document.createElement('span');
    label.id = 'lbl';
    label.textContent = 'Username';
    container.appendChild(label);

    const input = document.createElement('input');
    input.setAttribute('aria-labelledby', 'lbl');
    container.appendChild(input);

    expect(computeAriaLabel(input)).toBe('Username');
  });

  it('falls back to aria-labelledby (multiple ids, joined by space)', () => {
    const first = document.createElement('span');
    first.id = 'first';
    first.textContent = 'Account';
    container.appendChild(first);

    const second = document.createElement('span');
    second.id = 'second';
    second.textContent = 'Email';
    container.appendChild(second);

    const input = document.createElement('input');
    input.setAttribute('aria-labelledby', 'first second');
    container.appendChild(input);

    expect(computeAriaLabel(input)).toBe('Account Email');
  });

  it('returns undefined when neither attribute is set', () => {
    const el = document.createElement('button');
    container.appendChild(el);
    expect(computeAriaLabel(el)).toBeUndefined();
  });

  it('collapses whitespace runs in the explicit label', () => {
    const el = document.createElement('button');
    el.setAttribute('aria-label', '  Save   the   file  ');
    container.appendChild(el);
    expect(computeAriaLabel(el)).toBe('Save the file');
  });
});

describe('computeAccessibleNameSafe', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.removeChild(container);
  });

  it('uses aria-label when present', () => {
    const el = document.createElement('button');
    el.setAttribute('aria-label', 'Submit form');
    el.textContent = 'Submit';
    container.appendChild(el);
    expect(computeAccessibleNameSafe(el)).toBe('Submit form');
  });

  it('falls back to text content for buttons without aria-label', () => {
    const el = document.createElement('button');
    el.textContent = 'OK';
    container.appendChild(el);
    expect(computeAccessibleNameSafe(el)).toBe('OK');
  });

  it('resolves associated <label for> for inputs', () => {
    const lbl = document.createElement('label');
    lbl.setAttribute('for', 'fld');
    lbl.textContent = 'Full name';
    container.appendChild(lbl);

    const input = document.createElement('input');
    input.id = 'fld';
    container.appendChild(input);

    expect(computeAccessibleNameSafe(input)).toBe('Full name');
  });

  it('returns undefined when no accessible name can be computed', () => {
    const el = document.createElement('div');
    container.appendChild(el);
    expect(computeAccessibleNameSafe(el)).toBeUndefined();
  });
});

describe('computeVisibleText', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.removeChild(container);
  });

  it('returns trimmed text content', () => {
    const el = document.createElement('p');
    el.textContent = '  Hello world  ';
    container.appendChild(el);
    expect(computeVisibleText(el)).toBe('Hello world');
  });

  it('collapses whitespace runs', () => {
    const el = document.createElement('p');
    el.textContent = 'Hello\n\n  world\t\ttoday';
    container.appendChild(el);
    expect(computeVisibleText(el)).toBe('Hello world today');
  });

  it('returns undefined for empty elements', () => {
    const el = document.createElement('span');
    container.appendChild(el);
    expect(computeVisibleText(el)).toBeUndefined();
  });
});

describe('serializeRegisteredElement (A.5 fields populate end-to-end)', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    resetGlobalRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.removeChild(container);
    resetGlobalRegistry();
  });

  it('populates role, tagName, ariaLabel, accessibleName, text on the snapshot entry', () => {
    const registry = getGlobalRegistry();
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Save changes');
    btn.textContent = 'Save';
    container.appendChild(btn);

    registry.registerElement('save-btn', btn, { type: 'button', label: 'Save' });

    const snap = registry.createSnapshot();
    expect(snap.elements).toHaveLength(1);
    const el = snap.elements[0];

    expect(el.tagName).toBe('button');
    expect(el.role).toBe('button');
    expect(el.ariaLabel).toBe('Save changes');
    expect(el.accessibleName).toBe('Save changes');
    expect(el.text).toBe('Save');
  });

  it('emits the implicit role even without role= attribute', () => {
    const registry = getGlobalRegistry();
    const input = document.createElement('input');
    input.type = 'text';
    container.appendChild(input);

    registry.registerElement('email', input, { type: 'input' });

    const snap = registry.createSnapshot();
    expect(snap.elements[0].role).toBe('textbox');
  });

  it('omits ariaLabel / accessibleName / text when there is nothing to emit', () => {
    const registry = getGlobalRegistry();
    const div = document.createElement('div');
    container.appendChild(div);

    registry.registerElement('container', div, { type: 'custom' });

    const snap = registry.createSnapshot();
    const el = snap.elements[0];
    expect(el.ariaLabel).toBeUndefined();
    expect(el.accessibleName).toBeUndefined();
    expect(el.text).toBeUndefined();
  });
});
