/**
 * §4.6 INLINE-CHANNEL redaction contract (plan Phase 6).
 *
 * The typed serialization channel is closed by construction (the `Scrubbed<T>`
 * brand + `tsc`). This suite covers the parallel INLINE/UNTYPED channel that the
 * brand cannot reach: the page-analysis / summary / forms / tree relay commands
 * that read raw DOM content into inline object literals. The exemplar is
 * `analyzePageData`, which walked `document.querySelectorAll('form')` and emitted
 * `input.value` RAW — a live pre-existing HIGH leak that shipped password fields
 * and `data-bridge-redact` boundary values in cleartext.
 *
 * The contract, for every command below:
 *   1. `JSON.stringify(result)` contains NEITHER the password value NOR any
 *      secret inside a `data-bridge-redact` boundary.
 *   2. A named assertion pins the specific field to `REDACTED_VALUE`.
 *   3. [negative control] a non-redacted sibling's value/text STILL appears —
 *      no over-redaction.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';
import { REDACTED_VALUE } from '../core/redaction';
import { getGlobalRegistry } from '../core/registry';

const PW_SECRET = 'hunter2SuperSecret';
const BOUNDARY_CELL = 'SECRETCELLxyz';
const BOUNDARY_HEADER = 'SECRETHEADERxyz';
const BOUNDARY_ITEM = 'SECRETITEMxyz';
const BOUNDARY_REGION = 'SECRETREGIONxyz';
const BOUNDARY_FIELD = 'SECRETFIELDVALxyz';
const BOUNDARY_LABEL = 'SECRETLABELxyz';

// Non-redacted controls — MUST survive (no over-redaction).
const PUBLIC_USER = 'alicePublicUser';
const PUBLIC_CELL = 'PublicCellVisible';
const PUBLIC_HEADER = 'PublicHeaderVisible';
const PUBLIC_ITEM = 'PublicItemVisible';
const PUBLIC_REGION = 'PublicRegionVisible';
const PUBLIC_LABEL = 'PublicLabelVisible';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

const ALL_SECRETS = [
  PW_SECRET,
  BOUNDARY_CELL,
  BOUNDARY_HEADER,
  BOUNDARY_ITEM,
  BOUNDARY_REGION,
  BOUNDARY_FIELD,
  BOUNDARY_LABEL,
];

describe('executeCommand · §4.6 inline-channel redaction', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.innerHTML = `
      <form id="login">
        <input type="password" name="pw" />
        <input type="text" name="user" />
      </form>

      <table id="pubTable">
        <thead><tr><th>${PUBLIC_HEADER}</th></tr></thead>
        <tbody><tr><td>${PUBLIC_CELL}</td></tr></tbody>
      </table>
      <ul id="pubList"><li>${PUBLIC_ITEM}</li></ul>
      <main id="pubMain">${PUBLIC_REGION}</main>

      <div data-bridge-redact="true" id="vault">
        <table id="secretTable">
          <thead><tr><th>${BOUNDARY_HEADER}</th></tr></thead>
          <tbody><tr><td>${BOUNDARY_CELL}</td></tr></tbody>
        </table>
        <ul id="secretList"><li>${BOUNDARY_ITEM}</li></ul>
        <nav id="secretNav">${BOUNDARY_REGION}</nav>
        <form id="secretForm">
          <input type="text" name="cc" />
        </form>
      </div>
    `;
    document.body.appendChild(container);

    (container.querySelector('input[name="pw"]') as HTMLInputElement).value = PW_SECRET;
    (container.querySelector('input[name="user"]') as HTMLInputElement).value = PUBLIC_USER;
    (container.querySelector('input[name="cc"]') as HTMLInputElement).value = BOUNDARY_FIELD;
  });

  afterEach(() => {
    document.body.removeChild(container);
    getGlobalRegistry().clear();
  });

  function expectNoSecrets(result: unknown): void {
    const json = JSON.stringify(result);
    for (const secret of ALL_SECRETS) {
      expect(json).not.toContain(secret);
    }
  }

  it('analyzePageData: no password / boundary cleartext, controls survive', async () => {
    const result = (await executeCommand('analyzePageData', {}, emptyBridge)) as {
      forms: Array<{ id: string; fields: Array<{ name: string; type: string; value: string }> }>;
      tables: Array<{ headers: unknown[]; rows: unknown[][] }>;
    };

    expectNoSecrets(result);

    // Named assertion: the password field's value is the sentinel, not `hunter2…`.
    const login = result.forms.find((f) => f.id === 'login')!;
    const pwField = login.fields.find((f) => f.name === 'pw')!;
    expect(pwField.value).toBe(REDACTED_VALUE);

    // Named assertion: the boundary form's text field value is the sentinel.
    const secretForm = result.forms.find((f) => f.id === 'secretForm')!;
    expect(secretForm.fields.find((f) => f.name === 'cc')!.value).toBe(REDACTED_VALUE);

    // [negative control] the non-redacted username value survives.
    expect(login.fields.find((f) => f.name === 'user')!.value).toBe(PUBLIC_USER);
    expect(JSON.stringify(result)).toContain(PUBLIC_CELL);
    expect(JSON.stringify(result)).toContain(PUBLIC_HEADER);
  });

  it('analyzePageRegions: boundary landmark text is redacted, public survives', async () => {
    const result = (await executeCommand('analyzePageRegions', {}, emptyBridge)) as {
      regions: Array<{ role: string; tag: string; text: string }>;
    };

    expectNoSecrets(result);

    // The redacted <nav> landmark ships REDACTED_VALUE for its text.
    const secretNav = result.regions.find((r) => r.tag === 'nav')!;
    expect(secretNav.text).toBe(REDACTED_VALUE);

    // [negative control] the public <main> landmark keeps its text.
    expect(result.regions.some((r) => r.tag === 'main' && r.text.includes(PUBLIC_REGION))).toBe(
      true
    );
  });

  it('analyzeStructuredData: boundary cells/items redacted, public survive', async () => {
    const result = (await executeCommand('analyzeStructuredData', {}, emptyBridge)) as unknown;

    expectNoSecrets(result);

    const json = JSON.stringify(result);
    // [negative control] public table + list content survives.
    expect(json).toContain(PUBLIC_CELL);
    expect(json).toContain(PUBLIC_HEADER);
    expect(json).toContain(PUBLIC_ITEM);
    // The redacted cells/items appear as the sentinel somewhere.
    expect(json).toContain(REDACTED_VALUE);
  });

  it('getForms: boundary + password field values redacted, control survives', async () => {
    const result = (await executeCommand('getForms', {}, emptyBridge)) as {
      forms: Array<{ id: string; fields: Array<{ name: string; value: string }> }>;
    };

    expectNoSecrets(result);

    const login = result.forms.find((f) => f.id === 'login')!;
    expect(login.fields.find((f) => f.name === 'pw')!.value).toBe(REDACTED_VALUE);
    // [negative control] username value survives.
    expect(login.fields.find((f) => f.name === 'user')!.value).toBe(PUBLIC_USER);

    // The boundary form's field name is itself redacted, so index into it.
    const secretForm = result.forms.find((f) => f.id === 'secretForm')!;
    expect(secretForm.fields[0].value).toBe(REDACTED_VALUE);
  });

  it('getElementTree: boundary element text/label redacted, public survives', async () => {
    // getElementTree maps over the GLOBAL registry's elements.
    const vault = container.querySelector('#vault') as HTMLElement;
    const pubMain = container.querySelector('#pubMain') as HTMLElement;
    const secretEl = document.createElement('span');
    secretEl.textContent = BOUNDARY_CELL; // a boundary secret as its live text
    vault.appendChild(secretEl);

    const registry = getGlobalRegistry();
    registry.clear();
    registry.registerElement('secret-1', secretEl, { type: 'text', label: BOUNDARY_LABEL });
    registry.registerElement('public-1', pubMain, { type: 'text', label: PUBLIC_LABEL });

    const result = (await executeCommand('getElementTree', {}, emptyBridge)) as {
      tree: Array<{ id: string; tag: string; text: string }>;
    };

    expectNoSecrets(result);

    // The boundary element's scraped label + text collapse to the sentinel.
    expect(result.tree.find((t) => t.id === 'secret-1')!.text).toBe(REDACTED_VALUE);
    // [negative control] the public element keeps its label text.
    expect(result.tree.find((t) => t.id === 'public-1')!.text).toContain(PUBLIC_LABEL);
  });
});
