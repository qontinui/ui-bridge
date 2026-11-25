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
 * before the label moved to the canonical name. It must stay byte-identical
 * (D4: `executorIdText` is a frozen addressing-key input).
 *
 * The `label` / `accessibleName` literals are the canonical accessible name
 * (D1-D3): one row's `label`, `accessibleName` and `state.accessibleName`
 * agree, and agree with the DOM-fallback row's `label` for the same node. A
 * content-redacted node's `label` is `REDACTED_VALUE` with or without a name.
 * The rows whose literal changed from 69e61bbc carry an `// was:` note.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { REDACTED_VALUE } from '../core/redaction';
import { LABEL_MAX_CODE_POINTS } from '../core/a11y';
import { scanDOMForInteractiveElementsWithRefs } from '../server/dom-fallback';
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

/** The rows find() returns for {@link FIXTURE}, in scan order (ids: origin/main 69e61bbc). */
const PINNED: readonly Pinned[] = [
  ['pinned-save', 'Save', 'Save'], // data-ui-bridge-test-id rung
  ['save-order', 'Save order', 'Save order'], // data-testid rung
  ['checkout', 'Checkout now', 'Checkout now'], // html id rung
  ['button-generated-id', 'Generated id', 'Generated id'], // React `:r1a:` id skipped: slug
  ['button-close-dialog', 'Close dialog', 'Close dialog'], // aria-label slug
  ['button-print-page', 'Print page', 'Print page'], // title slug
  ['button-remove', 'Delete draft', 'Delete draft'], // multi-id aria-labelledby; id reads text
  ['input', 'Phone number', 'Phone number'], // id-less input named via aria-labelledby
  ['email', 'Email address', 'Email address'], // <label for> (was: label undefined)
  ['input-1', 'Subscribe', 'Subscribe'], // wrapping <label> (was: both undefined)
  ['button', 'Upload avatar', 'Upload avatar'], // <img alt> inside a button (was: both undefined)
  [
    'button-archive-every-finished-convers',
    'Archive every finished conversation today',
    'Archive every finished conversation today',
  ], // text over 40 characters (the id input's cut)
  [
    'button-send-this-message-to-every-mem',
    'Send this message to every member of the team right now please',
    'Send this message to every member of the team right now please',
  ], // text over 50 characters (was: both cut at 50, '…team righ')
  ['trash-btn', 'trash-btn', 'trash-btn'], // icon-only button with a data-testid, derived rung (was: both undefined)
  ['button-1', 'pencil', 'pencil'], // lucide icon button with no testid, derived rung (was: both undefined)
  ['button-duplicate', 'Duplicate', 'Duplicate'], // first of two same-slug siblings
  ['button-duplicate-1', 'Duplicate', 'Duplicate'], // the collision suffix
  ['button-refresh-the-list', 'Refresh the list', 'Refresh the list'], // whitespace normalised (was: 'Refresh    the\n    list')
  ['button-2', REDACTED_VALUE, REDACTED_VALUE], // named button inside a redaction boundary: structural id (was: both undefined)
  ['button-3', REDACTED_VALUE, undefined], // NAMELESS button inside a redaction boundary (was: label undefined)
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

describe('executor find label is the canonical accessible name', () => {
  it('agrees with state.accessibleName on every named row (label === accessibleName === state.accessibleName)', async () => {
    const rows = await findRows();
    expect(rows.map((row) => row.id)).toEqual(PINNED.map(([id]) => id));
    const named = rows.filter((row) => row.state.accessibleName !== undefined);
    // Every row but the nameless redacted one is named, and every name is
    // under the label cap — so the three fields must be byte-equal.
    expect(named).toHaveLength(PINNED.length - 1);
    for (const row of named) {
      expect([...row.state.accessibleName!].length).toBeLessThanOrEqual(LABEL_MAX_CODE_POINTS);
      expect(row.label).toBe(row.state.accessibleName);
      expect(row.accessibleName).toBe(row.state.accessibleName);
    }
  });

  it('reads the sentinel, not an absence, for a NAMELESS content-redacted node', async () => {
    const row = (await findRows()).find((r) => r.id === 'button-3')!;
    expect(row.state.redaction?.content).toBe(true);
    expect(row.label).toBe(REDACTED_VALUE);
    expect(row.state.accessibleName).toBeUndefined();
    expect(row.accessibleName).toBeUndefined();
  });

  it('carries the same label as the DOM-fallback row for the same node (matched by element)', async () => {
    const executorRows = (await executor.find({ includeHidden: true })).elements;
    // find() drops the live node from its returned rows; the fixture's scan
    // order is document order on both arms, so pair the executor rows with
    // the scanned nodes by re-reading them in the same order.
    const nodes = Array.from(document.body.querySelectorAll<HTMLElement>('button, input'));
    expect(nodes).toHaveLength(executorRows.length);
    expect(executorRows.map((row) => row.id)).toEqual(PINNED.map(([id]) => id));
    nodes.forEach((node, i) => expect(executorRows[i]!.tagName).toBe(node.tagName.toLowerCase()));
    const labelByNode = new Map(nodes.map((node, i) => [node, executorRows[i]!.label]));

    const fallbackRows = scanDOMForInteractiveElementsWithRefs();
    expect(fallbackRows).toHaveLength(PINNED.length);
    for (const fb of fallbackRows) {
      expect(labelByNode.has(fb.element)).toBe(true);
      expect(fb.label).toBe(labelByNode.get(fb.element));
    }
    // Including the nameless redacted node: both arms read the sentinel.
    const nameless = nodes[PINNED.length - 1]!;
    expect(fallbackRows.find((fb) => fb.element === nameless)!.label).toBe(REDACTED_VALUE);
  });

  it('find({ text: <secret> }) returns no row for the redacted fixture (oracle closed)', async () => {
    const res = await executor.find({ includeHidden: true, text: SECRET });
    expect(res.elements).toEqual([]);
    // Negative control: the same filter does match an unredacted row's name.
    const control = await executor.find({ includeHidden: true, text: 'Upload avatar' });
    expect(control.elements.map((row) => row.id)).toEqual(['button']);
  });
});

describe('executor find label: the registered and capped cases', () => {
  it('a registered interactive row keeps its registry label while accessibleName is the canonical name', async () => {
    document.body.innerHTML = '<button><img alt="Upload avatar"></button>';
    const registry = new UIBridgeRegistry();
    const button = document.body.querySelector('button')!;
    registry.registerElement('upload', button, { type: 'button', label: 'Registry upload' });
    const ex = new DefaultActionExecutor(registry);
    const row = (await ex.find({ includeHidden: true })).elements.find((r) => r.id === 'upload')!;
    expect(row.label).toBe('Registry upload');
    expect(row.state.accessibleName).toBe('Upload avatar');
    // was (69e61bbc): undefined -- the old chain missed `<img alt>`.
    expect(row.accessibleName).toBe('Upload avatar');
  });

  it('caps an unregistered label at LABEL_MAX_CODE_POINTS while accessibleName keeps the whole name', async () => {
    const name = 'Long '.repeat(60).trim(); // 299 code points, over the cap
    document.body.innerHTML = `<button>${name}</button>`;
    const row = (
      await new DefaultActionExecutor(new UIBridgeRegistry()).find({ includeHidden: true })
    ).elements[0]!;
    expect([...name].length).toBeGreaterThan(LABEL_MAX_CODE_POINTS);
    expect(row.accessibleName).toBe(name);
    expect(row.state.accessibleName).toBe(name);
    expect(row.label).toBe(`${[...name].slice(0, LABEL_MAX_CODE_POINTS).join('')}…`);
  });
});
