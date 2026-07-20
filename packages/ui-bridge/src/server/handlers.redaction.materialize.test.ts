/**
 * §4.6 redaction — regression tests for `materializeElements`.
 *
 * WHY THIS FILE EXISTS (the bypass it closes):
 * `materializeElements` is a SECOND, parallel snapshot-element serializer
 * that deliberately mirrors `serializeRegisteredElement`'s wire fields. It
 * calls the SAME a11y helpers (`computeAriaLabel`,
 * `computeAccessibleNameSafe`, `computeVisibleText`) plus a raw `title`
 * attribute that `serializeRegisteredElement` does not even emit — and it
 * did so with NO redaction gate. It backs the routes clients actually
 * reach: `/control/find`, `getElements`, the filtered variant,
 * `getElement`, and the snapshot repopulate / DOM-fallback paths.
 *
 * `el.getState?.()` was already scrubbed (by `getElementState`), which is
 * exactly why the first redaction pass looked complete: the `state` blob
 * was clean while the sibling attribute-derived fields shipped the secret
 * verbatim on every snapshot.
 *
 * Every LEAK test here was verified RED before the change (the gate
 * removed) and GREEN after. Tests that are DELIBERATE NEGATIVE CONTROLS —
 * proving no over-redaction, and passing in both states — are labelled
 * `[negative control]` in their title and are not claimed as regression
 * tests.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.6.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { materializeElements } from './handlers';
import { UIBridgeRegistry, REDACTED_VALUE } from '../core/registry';

const SECRET = 'SECRET123';

describe('materializeElements — snapshot projection honors §4.6', () => {
  let registry: UIBridgeRegistry;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => document.body.removeChild(container));

  /** A labelled, titled, text-bearing button inside a redact boundary. */
  function buildSecretButton(id: string): HTMLButtonElement {
    const boundary = document.createElement('div');
    boundary.setAttribute('data-bridge-redact', 'true');
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', `token: ${SECRET}`);
    btn.setAttribute('title', SECRET);
    btn.textContent = `copy ${SECRET}`;
    boundary.appendChild(btn);
    container.appendChild(boundary);
    registry.registerElement(id, btn, { type: 'button' });
    return btn;
  }

  it('scrubs ariaLabel / accessibleName / text / title on a redacted element', () => {
    buildSecretButton('secret-btn');
    const [entry] = materializeElements(registry.getAllElements());

    expect(entry.ariaLabel).toBe(REDACTED_VALUE);
    expect(entry.accessibleName).toBe(REDACTED_VALUE);
    expect(entry.text).toBe(REDACTED_VALUE);
    expect(entry.title).toBe(REDACTED_VALUE);
  });

  it('leaks the secret nowhere in the serialized wire payload', () => {
    buildSecretButton('secret-btn');
    const materialized = materializeElements(registry.getAllElements());

    // Blanket assertion — catches any field added later without a gate.
    expect(JSON.stringify(materialized)).not.toContain(SECRET);
  });

  it('KEEPS the a11y fields of a bare <input type="password"> — addressability', () => {
    // THE SPLIT (correct-by-design change). §4.6's unconditional password
    // rule governs the entered VALUE; a password field's label/title are
    // descriptive text and stay addressable. `state.value` is still scrubbed
    // by the state builder — see `registry.redaction.test.ts`.
    const input = document.createElement('input');
    input.type = 'password';
    input.setAttribute('aria-label', 'Password');
    input.setAttribute('title', 'Enter your password');
    container.appendChild(input);
    registry.registerElement('pw', input, { type: 'input' });

    const [entry] = materializeElements(registry.getAllElements());

    expect(entry.ariaLabel).toBe('Password');
    expect(entry.accessibleName).toBe('Password');
    expect(entry.title).toBe('Enter your password');
  });

  it('redacts a password input ONCE INSIDE a boundary', () => {
    const boundary = document.createElement('div');
    boundary.setAttribute('data-bridge-redact', 'true');
    const input = document.createElement('input');
    input.type = 'password';
    input.setAttribute('aria-label', `vault ${SECRET}`);
    input.setAttribute('title', SECRET);
    boundary.appendChild(input);
    container.appendChild(boundary);
    registry.registerElement('pw', input, { type: 'input' });

    const [entry] = materializeElements(registry.getAllElements());

    expect(entry.ariaLabel).toBe(REDACTED_VALUE);
    expect(entry.accessibleName).toBe(REDACTED_VALUE);
    expect(entry.title).toBe(REDACTED_VALUE);
    expect(JSON.stringify(entry)).not.toContain(SECRET);
  });

  it('[negative control] is PRESENCE-PRESERVING — an absent field stays undefined, never a fabricated sentinel', () => {
    const boundary = document.createElement('div');
    boundary.setAttribute('data-bridge-redact', 'true');
    const bare = document.createElement('div');
    boundary.appendChild(bare);
    container.appendChild(boundary);
    registry.registerElement('bare', bare, { type: 'generic' });

    const [entry] = materializeElements(registry.getAllElements());

    expect(entry.ariaLabel).toBeUndefined();
    expect(entry.accessibleName).toBeUndefined();
    expect(entry.text).toBeUndefined();
    expect(entry.title).toBeUndefined();
  });

  it('[negative control] does not throw on malformed input (missing / non-HTMLElement `element`)', () => {
    // `materializeElements` takes `unknown[]` and already uses optional
    // chaining throughout — the redaction gate must not regress that.
    expect(() =>
      materializeElements([
        { id: 'no-element' },
        { id: 'null-element', element: null },
        { id: 'bogus-element', element: {} },
      ])
    ).not.toThrow();
  });

  it('[negative control] does NOT redact structural fields (role / id / tagName survive)', () => {
    buildSecretButton('rolecheck');
    const [entry] = materializeElements(registry.getAllElements());

    expect(entry.id).toBe('rolecheck');
    expect(entry.tagName).toBe('button');
    expect(entry.role).toBe('button');
  });

  // ---- NEGATIVE CONTROL ----
  it('[negative control] does NOT over-redact a non-redacted element — name/text/title surface normally', () => {
    const publicBtn = document.createElement('button');
    publicBtn.setAttribute('aria-label', 'public save');
    publicBtn.setAttribute('title', 'Save the document');
    publicBtn.textContent = 'Save';
    container.appendChild(publicBtn);
    registry.registerElement('public-btn', publicBtn, { type: 'button' });

    const [entry] = materializeElements(registry.getAllElements());

    expect(entry.ariaLabel).toBe('public save');
    expect(entry.accessibleName).toBe('public save');
    expect(entry.text).toBe('Save');
    expect(entry.title).toBe('Save the document');
  });
});
