/**
 * §4.6 — HIGH-leak closure: the snapshot element `label` / `content` fields.
 *
 * Two-lens verification (2026-07-21) found that `label`/`content` on the
 * `BridgeSnapshot` element shape were NEVER branded, so `tsc` never forced
 * `serializeRegisteredElement` to route them through a minter — it emitted
 * `label: el.label` / `content: el.content` RAW. On auto-registered elements
 * `el.label` is SCRAPED from `aria-label`/`title`/text (F7), so a redacted
 * element's scraped label/content shipped raw on every `/control/snapshot`
 * while the sibling `accessibleName`/`text` were correctly scrubbed.
 *
 * This file exercises the EMISSION-layer closure through the public
 * `registry.createSnapshot()` / `serializeRegisteredElement` surface. It is
 * deliberately independent of F7 (the source-layer fix in `useAutoRegister`):
 * it simulates the already-scraped value by registering a secret-bearing
 * `label`/`content` on a redacted element and asserts the SERIALIZER redacts
 * it. Both layers must hold (see `useAutoRegister.redaction.test.tsx` for the
 * source layer) — either alone closes the leak, so this proves defense #1.
 *
 * Cross-link: plans/2026-07-20-ui-bridge-structural-redaction-enforcement.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry, REDACTED_VALUE, serializeRegisteredElement } from './registry';

const SECRET = 'SECRET123';

describe('§4.6 snapshot element label/content leak — EMISSION closure', () => {
  let registry: UIBridgeRegistry;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => container.remove());

  /** A redacted element whose SCRAPED-style `label` carries the secret. */
  function registerRedactedLabelled(): void {
    const boundary = document.createElement('div');
    boundary.setAttribute('data-bridge-redact', 'true');
    const btn = document.createElement('button');
    boundary.appendChild(btn);
    container.appendChild(boundary);
    // Mimic what `useAutoRegister.getAccessibleLabel` would have scraped into
    // `label` from an `aria-label`, pre-F7.
    registry.registerElement('secret-lbl', btn, { type: 'button', label: `open ${SECRET}` });
  }

  /** A redacted CONTENT element whose scraped text carries the secret. */
  function registerRedactedContent(): void {
    const boundary = document.createElement('div');
    boundary.setAttribute('data-bridge-redact', 'true');
    const card = document.createElement('div');
    boundary.appendChild(card);
    container.appendChild(boundary);
    registry.registerContentElement('secret-card', card, {
      contentType: 'content',
      contentMetadata: { contentRole: 'text' } as never,
      label: `card ${SECRET}`,
      content: `full text ${SECRET}`,
    });
  }

  it('serializeRegisteredElement scrubs a redacted element label', () => {
    registerRedactedLabelled();
    const el = registry.getElement('secret-lbl')!;
    const ser = serializeRegisteredElement(el);
    expect(ser.label).toBe(REDACTED_VALUE);
    expect(JSON.stringify(ser)).not.toContain(SECRET);
  });

  it('serializeRegisteredElement scrubs a redacted content element label AND content', () => {
    registerRedactedContent();
    const el = registry.getElement('secret-card')!;
    const ser = serializeRegisteredElement(el);
    expect(ser.label).toBe(REDACTED_VALUE);
    expect(ser.content).toBe(REDACTED_VALUE);
    expect(JSON.stringify(ser)).not.toContain(SECRET);
  });

  it('createSnapshot ships no raw label/content for redacted elements (whole-payload check)', () => {
    registerRedactedLabelled();
    registerRedactedContent();
    const snapshot = registry.createSnapshot();
    const lbl = snapshot.elements.find((e) => e.id === 'secret-lbl')!;
    const card = snapshot.elements.find((e) => e.id === 'secret-card')!;

    expect(lbl.label).toBe(REDACTED_VALUE);
    expect(card.label).toBe(REDACTED_VALUE);
    expect(card.content).toBe(REDACTED_VALUE);
    // The blanket guarantee: nowhere in the serialized snapshot.
    expect(JSON.stringify(snapshot)).not.toContain(SECRET);
  });

  // ---- NEGATIVE CONTROLS ----
  it('[negative control] a NON-redacted element ships its label/content unchanged', () => {
    const card = document.createElement('div');
    container.appendChild(card); // NOT inside a boundary
    registry.registerContentElement('public-card', card, {
      contentType: 'content',
      contentMetadata: { contentRole: 'text' } as never,
      label: 'Order summary',
      content: 'Order summary — 3 items',
    });
    const ser = serializeRegisteredElement(registry.getElement('public-card')!);
    expect(ser.label).toBe('Order summary');
    expect(ser.content).toBe('Order summary — 3 items');
  });

  it('[negative control] a bare <input type=password> keeps its dev label (addressability)', () => {
    const input = document.createElement('input');
    input.type = 'password';
    container.appendChild(input); // NO boundary — value-redacted only, not content
    registry.registerElement('pw', input, { type: 'input', label: 'Password' });
    const ser = serializeRegisteredElement(registry.getElement('pw')!);
    // CONTENT axis does not apply to a bare password field: its label survives.
    expect(ser.label).toBe('Password');
  });
});

describe('§4.6 searchElements — scraped-label matching ORACLE closure', () => {
  let registry: UIBridgeRegistry;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => container.remove());

  it('does NOT confirm a redacted element by searching its secret (scraped) label', () => {
    const boundary = document.createElement('div');
    boundary.setAttribute('data-bridge-redact', 'true');
    const btn = document.createElement('button');
    boundary.appendChild(btn);
    container.appendChild(boundary);
    // The label a pre-F7 auto-register would have scraped from an aria-label.
    registry.registerElement('secret', btn, { type: 'button', label: `token ${SECRET}` });

    // Exact-secret text search: an un-gated label score would be 1.0.
    const results = registry.searchElements({ text: `token ${SECRET}`, fuzzy: true });
    const hit = results.find((r) => r.element.id === 'secret');

    expect(hit?.scores.text ?? 0).toBeLessThan(0.7);
    expect(JSON.stringify(results)).not.toContain(SECRET);
  });

  it('[negative control] a NON-redacted element IS findable by its exact label', () => {
    const btn = document.createElement('button');
    container.appendChild(btn); // not redacted
    registry.registerElement('public', btn, { type: 'button', label: 'Rotate keys' });

    const results = registry.searchElements({ text: 'Rotate keys', fuzzy: true });
    const hit = results.find((r) => r.element.id === 'public');

    expect(hit).toBeDefined();
    expect(hit!.scores.text ?? 0).toBeGreaterThanOrEqual(0.7);
  });
});
