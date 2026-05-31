/**
 * Tests for §4.6 sensitive-data redaction + §4.5 bridge-invisible
 * subtree hard-exclusion.
 *
 * The redaction path lives in `getElementState` (registry.ts after the
 * §4.6 edit): an `<input>` / `<textarea>` / `<select>` whose value would
 * normally be captured has `state.value` (and for select,
 * `selectedOptions` + `availableOptions`) replaced with `REDACTED_VALUE`
 * when either of these is true:
 *
 *   1. `data-bridge-redact="true"` is present on the element OR any
 *      ancestor (so a `<form data-bridge-redact="true">` covers its
 *      whole subtree).
 *   2. The element is `<input type="password">` — redacted
 *      unconditionally because every browser already treats it as
 *      sensitive.
 *
 * The invisibility path lives in `useAutoRegister.shouldRegisterElement`:
 * `data-bridge-invisible="true"` on the element OR any ancestor causes
 * the registrable-check to return false. We test the predicate function
 * directly here (`isBridgeInvisible`) since the AutoRegister hook is a
 * separate test file and the predicate is the security-critical part.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.5, §4.6.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry, isBridgeInvisible, REDACTED_VALUE } from './registry';

describe('REDACTED_VALUE', () => {
  it('is the public sentinel callers can match on', () => {
    expect(REDACTED_VALUE).toBe('[REDACTED]');
  });
});

describe('data-bridge-redact on text inputs', () => {
  let registry: UIBridgeRegistry;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('redacts state.value when the input itself has data-bridge-redact="true"', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = 'super-secret-token';
    input.setAttribute('data-bridge-redact', 'true');
    container.appendChild(input);
    const reg = registry.registerElement('inp', input, { type: 'input' });
    const state = reg.getState();
    expect(state.value).toBe(REDACTED_VALUE);
    expect(state.value).not.toContain('super-secret-token');
  });

  it('redacts when an ancestor has data-bridge-redact="true"', () => {
    const form = document.createElement('form');
    form.setAttribute('data-bridge-redact', 'true');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = 'secret-from-form';
    form.appendChild(input);
    container.appendChild(form);
    const reg = registry.registerElement('inp', input, { type: 'input' });
    expect(reg.getState().value).toBe(REDACTED_VALUE);
  });

  it('does NOT redact when no attribute is present', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = 'public-value';
    container.appendChild(input);
    const reg = registry.registerElement('inp', input, { type: 'input' });
    expect(reg.getState().value).toBe('public-value');
  });

  it('does NOT redact when attribute is "false" / "" / "yes" — only literal "true"', () => {
    // Defensive: only the literal string "true" turns redaction on.
    // A typo or stray empty attribute must NOT silently activate it.
    let suffix = 0;
    for (const v of ['false', '', 'yes', '1', 'redact']) {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = `value-${suffix}`;
      input.setAttribute('data-bridge-redact', v);
      container.appendChild(input);
      const reg = registry.registerElement(`inp-${suffix}`, input, { type: 'input' });
      expect(reg.getState().value, `attr="${v}" should NOT redact`).toBe(`value-${suffix}`);
      suffix++;
    }
  });

  it('redacts type="password" inputs UNCONDITIONALLY (no attribute needed)', () => {
    const input = document.createElement('input');
    input.type = 'password';
    input.value = 'hunter2';
    container.appendChild(input);
    const reg = registry.registerElement('inp', input, { type: 'input' });
    expect(reg.getState().value).toBe(REDACTED_VALUE);
  });
});

describe('data-bridge-redact on textarea', () => {
  let registry: UIBridgeRegistry;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => document.body.removeChild(container));

  it('redacts when set on the textarea', () => {
    const ta = document.createElement('textarea');
    ta.value = 'multi\nline\nsecret';
    ta.setAttribute('data-bridge-redact', 'true');
    container.appendChild(ta);
    const reg = registry.registerElement('ta', ta, { type: 'textarea' });
    expect(reg.getState().value).toBe(REDACTED_VALUE);
  });
});

describe('data-bridge-redact on select', () => {
  let registry: UIBridgeRegistry;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => document.body.removeChild(container));

  it('redacts value + selectedOptions + availableOptions', () => {
    // Selects in sensitive contexts can leak via option labels (e.g.
    // an env switcher with token-bearing URLs as labels). Make sure
    // ALL three observable fields are scrubbed and the labels are gone.
    const sel = document.createElement('select');
    sel.innerHTML = `
      <option value="staging-token-abc" selected>staging (token: abc)</option>
      <option value="prod-token-xyz">prod (token: xyz)</option>
    `;
    sel.setAttribute('data-bridge-redact', 'true');
    container.appendChild(sel);
    const reg = registry.registerElement('sel', sel, { type: 'select' });
    const state = reg.getState();
    expect(state.value).toBe(REDACTED_VALUE);
    expect(state.selectedOptions).toEqual([REDACTED_VALUE]);
    expect(state.availableOptions).toHaveLength(1);
    expect(state.availableOptions?.[0]?.value).toBe(REDACTED_VALUE);
    expect(state.availableOptions?.[0]?.label).toBe(REDACTED_VALUE);
    const blob = JSON.stringify(state);
    expect(blob).not.toContain('staging-token-abc');
    expect(blob).not.toContain('prod-token-xyz');
    expect(blob).not.toContain('staging (token:');
  });
});

describe('isBridgeInvisible', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => document.body.removeChild(container));

  it('is true when the element itself carries data-bridge-invisible="true"', () => {
    const el = document.createElement('div');
    el.setAttribute('data-bridge-invisible', 'true');
    container.appendChild(el);
    expect(isBridgeInvisible(el)).toBe(true);
  });

  it('is true when an ancestor carries data-bridge-invisible="true"', () => {
    const banner = document.createElement('div');
    banner.setAttribute('data-bridge-invisible', 'true');
    const inner = document.createElement('button');
    banner.appendChild(inner);
    container.appendChild(banner);
    expect(isBridgeInvisible(inner)).toBe(true);
  });

  it('is false when no ancestor has the attribute', () => {
    const el = document.createElement('div');
    container.appendChild(el);
    expect(isBridgeInvisible(el)).toBe(false);
  });

  it('only literal "true" activates — typos / empty / "false" are NOT invisible', () => {
    for (const v of ['false', '', 'yes', '1', 'invisible']) {
      const el = document.createElement('div');
      el.setAttribute('data-bridge-invisible', v);
      container.appendChild(el);
      expect(isBridgeInvisible(el), `attr="${v}" must NOT be invisible`).toBe(false);
      container.removeChild(el);
    }
  });
});
