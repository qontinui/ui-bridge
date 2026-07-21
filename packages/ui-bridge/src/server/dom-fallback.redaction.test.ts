import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  scanDOMForInteractiveElements,
  findElementsByText,
  findElementByLabel,
} from './dom-fallback';

/**
 * §4.6 Gap A — the DOM-fallback discovery path (`/control/elements` when the
 * registry is empty) builds client-facing element data straight from the DOM.
 * Its content/value reads used to be hand-gated with `isContentRedacted` /
 * `isValueRedacted` ternaries; a future edit dropping a ternary would have
 * shipped cleartext undetected because the file was outside the §4.6 Layer-2
 * lint guard. This locks in the minted (`readScrubbedText`/`readScrubbedValue`)
 * projection + the addressability guarantee for password fields.
 */
const REDACTED = '[REDACTED]';

describe('dom-fallback discovery redaction', () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = `
      <section data-bridge-redact="true">
        <button id="secret" aria-label="Reveal SSN">123-45-6789</button>
      </section>
      <input id="pw" type="password" aria-label="Password" value="hunter2" />
      <button id="plain" aria-label="Save">Save order</button>
    `;
    document.body.appendChild(root);
  });

  afterEach(() => root.remove());

  function byId(id: string) {
    return scanDOMForInteractiveElements(root).find((e) => e.identifiers.htmlId === id);
  }

  it('scrubs text/label/aria-label for an element inside a boundary', () => {
    const el = byId('secret');
    expect(el?.label).toBe(REDACTED);
    expect(el?.state.textContent).toBe(REDACTED);
    expect(el?.identifiers.ariaLabel).toBe(REDACTED);
  });

  it('scrubs a password value but keeps the field addressable (label survives)', () => {
    const el = byId('pw');
    expect(el?.state.value).toBe(REDACTED);
    // Password is value-redacted only, NOT content-redacted — so it stays
    // findable by its label/aria-label.
    expect(el?.label).toBe('Password');
    expect(el?.identifiers.ariaLabel).toBe('Password');
  });

  it('surfaces a non-redacted element normally', () => {
    const el = byId('plain');
    expect(el?.label).toBe('Save');
    expect(el?.state.textContent).toBe('Save order');
  });

  it('text/label lookups still match after the a11y-reader migration', () => {
    expect(findElementsByText('Save order', { root })).toHaveLength(1);
    expect(findElementByLabel('Password', root)?.getAttribute('id')).toBe('pw');
  });

  it('normalizes internal whitespace when matching visible text', () => {
    // The a11y `computeVisibleText` reader collapses whitespace runs, so an
    // exact search with single spaces matches DOM text authored with several.
    // (In jsdom `innerText` is unimplemented, so this exercises the textContent
    // fallback + normalization path — the drift that IS reproducible here.)
    const btn = document.createElement('button');
    btn.id = 'ws';
    btn.textContent = 'Add    to     cart';
    root.appendChild(btn);
    expect(findElementsByText('Add to cart', { root, exact: true })).toHaveLength(1);
  });

  it('emits empty (not the sentinel) for an empty content-redacted element', () => {
    // Presence-preserving scrub: empty carries no secret, so it collapses to ''
    // rather than to REDACTED — aligning dom-fallback with the canonical minter
    // shape used everywhere else (was: unconditional REDACTED sentinel).
    const empty = document.createElement('div');
    empty.innerHTML = `<section data-bridge-redact="true"><button id="blank"></button></section>`;
    root.appendChild(empty);
    const el = scanDOMForInteractiveElements(root).find((e) => e.identifiers.htmlId === 'blank');
    expect(el?.state.textContent).toBe('');
  });
});
