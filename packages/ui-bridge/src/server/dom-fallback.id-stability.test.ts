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
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scanDOMForInteractiveElementsWithRefs } from './dom-fallback';

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
