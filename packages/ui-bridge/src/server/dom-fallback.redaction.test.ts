import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  scanDOMForInteractiveElements,
  scanDOMForInteractiveElementRefs,
  findElementsByText,
  findElementByLabel,
} from './dom-fallback';
import { UIBridgeRegistry } from '../core/registry';
import { seedRegistryFromDom } from '../injected/seed-registry';

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

/**
 * §4.6: a fallback id never carries redacted text — plan
 * `2026-11-24-ui-bridge-find-visibility-and-fallback-label-read-the-canonical-verdicts`,
 * Phase 2 (coord finding 68ad69c6). `generateId` used to slug the UNSCRUBBED
 * text of an element with no `data-testid` or `id`, so a button inside a
 * boundary got `dom-button-123-45-6789` while its `label` read the sentinel.
 */
describe('dom-fallback ids inside a redaction boundary', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('skips the text slug: the id is the type/index tail and carries no redacted text', () => {
    document.body.innerHTML = `
      <section data-bridge-redact="true"><button>123-45-6789</button></section>
      <button>123-45-6789</button>
    `;
    const rows = scanDOMForInteractiveElements();
    // origin/main: 'dom-button-123-45-6789'.
    expect(rows[0].id).toBe('dom-button-0');
    expect(rows[0].label).toBe(REDACTED);
    // Outside the boundary the same text still slugs (the id is not redacted there).
    expect(rows[1].id).toBe('dom-button-123-45-6789');
    // Every path that reports these ids agrees: the ref scan and the seeder.
    expect(scanDOMForInteractiveElementRefs()[0].id).toBe('dom-button-0');
    const registry = new UIBridgeRegistry();
    seedRegistryFromDom(registry, document.body);
    expect(registry.getElement('dom-button-0')?.label).toBe(REDACTED);
    expect(registry.getAllElements().filter((e) => e.id.includes('123'))).toHaveLength(1);
  });

  it('no row inside a boundary has an id containing its text, whatever rung named it', () => {
    document.body.innerHTML = `
      <div data-bridge-redact="true">
        <button aria-label="Reveal 123">x</button>
        <button title="Token 123"></button>
        <input placeholder="SSN 123" />
        <a href="/x">Account 123</a>
      </div>
    `;
    const ids = scanDOMForInteractiveElements().map((r) => r.id);
    expect(ids).toEqual(['dom-button-0', 'dom-button-1', 'dom-input-2', 'dom-link-3']);
    for (const id of ids) expect(id).not.toContain('123');
  });

  it('keeps the data-testid and html id rungs inside a boundary', () => {
    document.body.innerHTML = `
      <section data-bridge-redact="true">
        <button data-testid="reveal-ssn">123-45-6789</button>
        <button id="copy-ssn">123-45-6789</button>
      </section>
    `;
    const ids = scanDOMForInteractiveElements().map((r) => r.id);
    expect(ids).toEqual(['dom-reveal-ssn', 'dom-copy-ssn']);
  });
});
