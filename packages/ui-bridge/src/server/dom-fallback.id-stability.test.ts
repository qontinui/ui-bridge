/**
 * DOM-fallback ids are addressing keys — plan
 * `2026-11-24-ui-bridge-find-visibility-and-fallback-label-read-the-canonical-verdicts`, D4.
 *
 * Agents, workflows and the runner hold a fallback id (`dom-…`) across
 * releases, so an id must not move when the row's DISPLAY label moves. The
 * fixture has one element per id rung (`data-testid`, html `id`, the text
 * slug, the `dom-<type>-<index>` tail) and one per place where the frozen id
 * input and the canonical accessible name differ: a multi-id
 * `aria-labelledby`, a wrapping `<label>`, `placeholder`, an `<img alt>`, a
 * no-name icon button, text past the 30-character slug cut, and two
 * same-label siblings (the `-2` collision suffix).
 *
 * Every id below is a LITERAL captured from ui-bridge `origin/main` cefa490d,
 * before the label moved to the canonical name. It must stay byte-identical.
 *
 * The same fixture pins D3: the row's `label` (and the seeded registry
 * element's `label`) is the canonical accessible name — the value
 * `state.accessibleName` carries — not the frozen id input.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  scanDOMForInteractiveElementRefs,
  scanDOMForInteractiveElementsWithRefs,
} from './dom-fallback';
import { getElementState } from '../core/element-state';
import { UIBridgeRegistry } from '../core/registry';
import { seedRegistryFromDom } from '../injected/seed-registry';

/** Document order is the scan order, so each row is addressed by its index. */
const ID_FIXTURE = `
  <button data-testid="save-order">Save order</button>
  <button id="checkout">Checkout now</button>
  <span id="lbl-one">Archive</span>
  <button aria-labelledby="lbl-one">x</button>
  <span id="lbl-a">Delete</span><span id="lbl-b">draft</span>
  <button aria-labelledby="lbl-a lbl-b">Remove</button>
  <label>Subscribe <input type="checkbox" /></label>
  <label for="email">Email address</label><input id="email" type="text" />
  <button title="Print page"></button>
  <input type="text" placeholder="Search docs" />
  <button><img src="x.png" alt="Upload avatar" /></button>
  <button>Send this message to every member of the team now</button>
  <button><svg class="lucide lucide-trash"></svg></button>
  <button>Duplicate</button>
  <button>Duplicate</button>
`;

/** The ids origin/main cefa490d generates for {@link ID_FIXTURE}, in scan order. */
const ID_FIXTURE_IDS = [
  'dom-save-order', // data-testid rung
  'dom-checkout', // html id rung
  'dom-button-archive', // single-id aria-labelledby, slugged
  'dom-button-remove', // multi-id aria-labelledby: the frozen input reads the text
  'dom-checkbox-4', // wrapping <label>: the frozen input is empty, so the index tail
  'dom-email', // <label for>: the html id rung wins
  'dom-button-print-page', // title, slugged
  'dom-input-search-docs', // placeholder, slugged
  'dom-button-8', // <img alt> inside a button: frozen input empty, index tail
  'dom-button-send-this-message-to-every-mem', // slug cut at 30 characters
  'dom-button-10', // no-name lucide icon button: index tail
  'dom-button-duplicate', // first of two same-label siblings
  'dom-button-duplicate-2', // the collision suffix
];

beforeEach(() => {
  document.body.innerHTML = ID_FIXTURE;
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DOM-fallback id stability', () => {
  it('generates the origin/main cefa490d id for every rung and name-difference case', () => {
    const ids = scanDOMForInteractiveElementsWithRefs().map((row) => row.id);
    expect(ids).toEqual(ID_FIXTURE_IDS);
  });
});

/**
 * The canonical name of every fixture row, in scan order, as LITERALS. Where
 * the pre-D3 chain (now only the frozen id input) gave something else, the old
 * value is in the comment.
 */
const CANONICAL_LABELS = [
  'Save order',
  'Checkout now',
  'Archive',
  'Delete draft', // old chain: 'Remove' (it resolved only a single-id aria-labelledby)
  'Subscribe', // old chain: '' (it ignored a wrapping <label>)
  'Email address',
  'Print page',
  '', // old chain: 'Search docs' (accname gives a placeholder no name here; no derived rung)
  'Upload avatar', // old chain: '' (it ignored <img alt>)
  'Send this message to every member of the team now',
  'trash', // old chain: '' (the derived icon-token rung, nameSource 'derived')
  'Duplicate',
  'Duplicate',
];

describe('DOM-fallback label is the canonical accessible name', () => {
  it('a multi-id aria-labelledby and a wrapping <label> read the canonical literal', () => {
    const rows = scanDOMForInteractiveElementsWithRefs();
    // Old chain: 'Remove' — the whole "lbl-a lbl-b" was looked up as ONE id.
    expect(rows[3].label).toBe('Delete draft');
    // Old chain: '' — a wrapping <label> was never read.
    expect(rows[4].label).toBe('Subscribe');
  });

  it('every row reads the canonical literal', () => {
    expect(scanDOMForInteractiveElementsWithRefs().map((row) => row.label)).toEqual(
      CANONICAL_LABELS
    );
  });

  it("every row's label equals its state.accessibleName (all names are under 200 code points)", () => {
    for (const row of scanDOMForInteractiveElementsWithRefs()) {
      expect(row.label).toBe(getElementState(row.element).accessibleName ?? '');
    }
  });

  it('caps a long canonical name at 200 code points plus an ellipsis', () => {
    document.body.innerHTML = `<button aria-label="${'n'.repeat(250)}">x</button>`;
    const [row] = scanDOMForInteractiveElementsWithRefs();
    expect(row.label).toBe('n'.repeat(200) + '…');
    // The id input is frozen: aria-label first, sliced to the 30-char slug.
    expect(row.id).toBe('dom-button-' + 'n'.repeat(30));
  });

  it('the ref-only scan agrees with the full scan on (id, label)', () => {
    const full = scanDOMForInteractiveElementsWithRefs().map(({ id, label }) => ({ id, label }));
    const refs = scanDOMForInteractiveElementRefs().map(({ id, label }) => ({ id, label }));
    expect(refs).toEqual(full);
    expect(refs.map((r) => r.id)).toEqual(ID_FIXTURE_IDS);
  });

  it('the injected seeder registers the canonical label under the unchanged id', () => {
    const registry = new UIBridgeRegistry();
    seedRegistryFromDom(registry, document.body);
    const byId = (id: string) => registry.getElement(id);
    expect(byId('dom-button-remove')?.label).toBe('Delete draft');
    expect(byId('dom-checkbox-4')?.label).toBe('Subscribe');
    expect(byId('dom-button-8')?.label).toBe('Upload avatar');
    expect(byId('dom-button-10')?.label).toBe('trash');
    expect(byId('dom-save-order')?.label).toBe('Save order');
  });
});
