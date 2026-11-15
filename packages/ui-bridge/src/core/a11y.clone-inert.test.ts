/**
 * The boundary-free accname clone is inert: building it runs no custom element
 * constructor (the same no-browsing-context property keeps a cloned `<img src>`
 * from fetching; jsdom cannot observe a fetch, so the constructor is the proof),
 * and a file input in the chain keeps the name.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { computeAccessibleNameSafe } from './a11y';
import { REDACTED_VALUE } from './redaction';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('accname clone is built in an inert document', () => {
  it('never runs a defined custom element constructor', () => {
    let constructed = 0;
    class CountingEl extends HTMLElement {
      constructor() {
        super();
        constructed++;
      }
    }
    customElements.define('count-el', CountingEl);
    document.body.innerHTML =
      '<button id="b">Pay <count-el>inside</count-el><span data-bridge-redact="true">tok-SECRET</span></button>';
    const afterParse = constructed;
    expect(afterParse).toBe(1);
    const name = computeAccessibleNameSafe(document.getElementById('b')!) ?? '';
    expect(name).toBe(`Pay inside ${REDACTED_VALUE}`);
    expect(constructed).toBe(afterParse);
  });
});

describe('inputs in the name chain', () => {
  it('keeps the name when a selected file input is in a labelled chain', () => {
    document.body.innerHTML =
      '<label for="t">Upload <input id="f" type="file"> <span data-bridge-redact="true">tok</span></label><input id="t" type="text">';
    const f = document.getElementById('f') as HTMLInputElement;
    Object.defineProperty(f, 'files', { configurable: true, value: [new File(['x'], 'a.txt')] });
    const name = computeAccessibleNameSafe(document.getElementById('t')!) ?? '';
    expect(name).toContain('Upload');
    expect(name).toContain(REDACTED_VALUE);
  });

  it('never carries a password value into the clone', () => {
    document.body.innerHTML =
      '<div role="button" id="x">Pin <input id="p" type="password" value="hunter2"><span data-bridge-redact="true">t</span></div>';
    (document.getElementById('p') as HTMLInputElement).value = 'hunter2';
    const name = computeAccessibleNameSafe(document.getElementById('x')!) ?? '';
    expect(name).not.toContain('hunter2');
  });
});
