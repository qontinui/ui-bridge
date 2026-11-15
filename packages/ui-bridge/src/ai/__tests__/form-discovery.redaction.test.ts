/**
 * §4.6 on the `/control/forms` transport: a field's label and error text are
 * read from OTHER elements (`<label>`, `aria-describedby` / adjacent error
 * nodes), whose redaction verdict the field's own verdict says nothing about.
 * They used to be read with `textContent` and scrubbed by the field's verdict,
 * so a label or error that holds a `data-bridge-redact` boundary shipped it.
 *
 * Plan: 2026-11-13-the-runners-read-value-serves-password-values-raw (review
 * round 4, findings A23 and A26).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { discoverForms, type FormDiscoveryElement } from '../form-discovery';
import type { ElementState } from '../../core/types';

const SECRET = 'ACC-998877';

function input(id: string, el: HTMLElement): FormDiscoveryElement {
  return {
    id,
    element: el,
    type: 'input',
    getState: (): ElementState => ({
      visible: true,
      enabled: true,
      focused: false,
      rect: { x: 0, y: 0, width: 100, height: 30, top: 0, right: 100, bottom: 30, left: 0 },
      value: (el as HTMLInputElement).value,
    }),
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('discoverForms keeps label and error text outside redaction boundaries', () => {
  it.each([
    [
      'a <label for> holding a boundary',
      `<form><label for="f">Account <span data-bridge-redact="true">${SECRET}</span></label><input id="f"></form>`,
    ],
    [
      'a wrapping <label> holding a boundary',
      `<form><label>Account <span data-bridge-redact="true">${SECRET}</span><input id="f"></label></form>`,
    ],
    [
      'a wrapping <label> inside a boundary',
      `<form><div data-bridge-redact="true"><label>Account ${SECRET}<input id="f"></label></div></form>`,
    ],
    [
      'an aria-describedby error holding a boundary',
      `<form><input id="f" aria-invalid="true" aria-label="Account" aria-describedby="e"><p id="e" role="alert">Bad <b data-bridge-redact="true">${SECRET}</b></p></form>`,
    ],
  ])('%s: no field carries the boundary text', (_c, html) => {
    document.body.innerHTML = html;
    const el = document.getElementById('f')!;
    const response = discoverForms([input('f', el)]);
    expect(JSON.stringify(response)).not.toContain(SECRET);
    expect(JSON.stringify(response)).toContain('[REDACTED]');
  });
});
