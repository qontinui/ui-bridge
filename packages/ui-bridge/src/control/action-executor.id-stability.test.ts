/**
 * Executor find ids are addressing keys — plan
 * `2026-11-24-ui-bridge-executor-find-label-reads-the-canonical-accessible-name`.
 *
 * Agents, workflows and the runner hold an executor id (`button-save`,
 * `input-1`, …) across releases, so an id must not move when the row's
 * DISPLAY name moves. The fixture holds unregistered elements under the
 * executor's scan selectors: one per id rung (`data-ui-bridge-test-id`,
 * `data-testid`, html `id`, a skipped React `:r1a:` id, the text slug, the
 * structural `tag`(-n) tail) and one per place where the executor's old name
 * chains and the canonical accessible name differ (multi-id
 * `aria-labelledby`, `<label for>`, a wrapping `<label>`, an `<img alt>`, the
 * `derived` rung, text past 40 / 50 characters, whitespace, a redaction
 * boundary with and without a name).
 *
 * Every id below is a LITERAL captured from ui-bridge `origin/main` 69e61bbc,
 * before the label moved to the canonical name. It must stay byte-identical.
 * The `label` / `accessibleName` literals are the values the same row carries
 * at that sha, so a change to either shows up as a diff to a named literal.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';
import type { DiscoveredElement } from './types';

/** Document order is the scan order, so each row is addressed by its index. */
const FIXTURE = `
  <button data-ui-bridge-test-id="pinned-save">Save</button>
  <button data-testid="save-order">Save order</button>
  <button id="checkout">Checkout now</button>
  <button id=":r1a:">Generated id</button>
  <button aria-label="Close dialog">x</button>
  <button title="Print page"></button>
  <span id="lbl-a">Delete</span><span id="lbl-b">draft</span>
  <button aria-labelledby="lbl-a lbl-b">Remove</button>
  <label id="lbl-phone">Phone number</label><input type="text" aria-labelledby="lbl-phone" />
  <label for="email">Email address</label><input id="email" type="text" />
  <label>Subscribe <input type="checkbox" /></label>
  <button><img src="x.png" alt="Upload avatar" /></button>
  <button>Archive every finished conversation today</button>
  <button>Send this message to every member of the team right now please</button>
  <button data-testid="trash-btn"><svg></svg></button>
  <button><svg class="lucide lucide-pencil"></svg></button>
  <button>Duplicate</button>
  <button>Duplicate</button>
  <button>
    Refresh    the
    list
  </button>
  <div data-bridge-redact="true"><button>Account SECRET-4111</button></div>
  <div data-bridge-redact="true"><button></button></div>
`;

/** The secret inside the named redaction boundary. */
const SECRET = 'SECRET-4111';

/** One expected row: `[id, label, accessibleName]` as find() returns them. */
type Pinned = readonly [id: string, label: string | undefined, accessibleName: string | undefined];

/** The rows origin/main 69e61bbc returns for {@link FIXTURE}, in scan order. */
const PINNED: readonly Pinned[] = [
  ['pinned-save', 'Save', 'Save'], // data-ui-bridge-test-id rung
  ['save-order', 'Save order', 'Save order'], // data-testid rung
  ['checkout', 'Checkout now', 'Checkout now'], // html id rung
  ['button-generated-id', 'Generated id', 'Generated id'], // React `:r1a:` id skipped: slug
  ['button-close-dialog', 'Close dialog', 'Close dialog'], // aria-label slug
  ['button-print-page', 'Print page', 'Print page'], // title slug
  ['button-remove', 'Delete draft', 'Delete draft'], // multi-id aria-labelledby; id reads text
  ['input', 'Phone number', 'Phone number'], // id-less input named via aria-labelledby
  ['email', undefined, 'Email address'], // <label for>: the old label chain misses it
  ['input-1', undefined, undefined], // wrapping <label>
  ['button', undefined, undefined], // <img alt> inside a button
  [
    'button-archive-every-finished-convers',
    'Archive every finished conversation today',
    'Archive every finished conversation today',
  ], // text over 40 characters (the id input's cut)
  [
    'button-send-this-message-to-every-mem',
    'Send this message to every member of the team righ',
    'Send this message to every member of the team righ',
  ], // text over 50 characters (the old label cut)
  ['trash-btn', undefined, undefined], // icon-only button with a data-testid (derived rung)
  ['button-1', undefined, undefined], // lucide icon button with no testid (derived rung)
  ['button-duplicate', 'Duplicate', 'Duplicate'], // first of two same-slug siblings
  ['button-duplicate-1', 'Duplicate', 'Duplicate'], // the collision suffix
  ['button-refresh-the-list', 'Refresh    the\n    list', 'Refresh    the\n    list'], // whitespace the old chains do not normalise
  ['button-2', undefined, undefined], // named button inside a redaction boundary: structural id
  ['button-3', undefined, undefined], // NAMELESS button inside a redaction boundary
];

let executor: DefaultActionExecutor;

/** jsdom rects are zero-size, so every fixture is `visible: false`; keep them. */
async function findRows(): Promise<DiscoveredElement[]> {
  return (await executor.find({ includeHidden: true })).elements;
}

beforeEach(() => {
  document.body.innerHTML = FIXTURE;
  executor = new DefaultActionExecutor(new UIBridgeRegistry());
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('executor find id stability', () => {
  it('generates the origin/main 69e61bbc id for every rung and name-difference case', async () => {
    const ids = (await findRows()).map((row) => row.id);
    expect(ids).toEqual(PINNED.map(([id]) => id));
  });

  it('returns the same ids on a second find() (the discovery cache is reset per call)', async () => {
    await findRows();
    const ids = (await findRows()).map((row) => row.id);
    expect(ids).toEqual(PINNED.map(([id]) => id));
  });

  it('carries the pinned label and accessibleName on every row', async () => {
    const rows = await findRows();
    expect(rows.map((row) => [row.id, row.label, row.accessibleName])).toEqual(
      PINNED.map((p) => [...p])
    );
  });

  it('never carries the redacted secret in an id, label or accessibleName', async () => {
    const rows = await findRows();
    for (const row of rows) {
      expect(row.id).not.toContain(SECRET);
      expect(row.label ?? '').not.toContain(SECRET);
      expect(row.accessibleName ?? '').not.toContain(SECRET);
    }
  });
});
