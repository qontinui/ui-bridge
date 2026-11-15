/**
 * `readValuePrimitive` reads the right property, and ancestor selection does not
 * get around a redaction boundary.
 *
 * 1. Non-form elements that carry a `.value` PROPERTY (`<li>` is a number,
 *    `<button>` with no value attribute is "") used to read that property
 *    instead of their text: an `<li>` read back the number 0.
 * 2. An element that CONTAINS a `data-bridge-redact="true"` boundary, without
 *    being inside one, used to read the boundary's text through its own
 *    `textContent`, so `read-value {"selector":"body"}` returned redacted text.
 *
 * Plan: 2026-11-13-the-runners-read-value-serves-password-values-raw (review of
 * the landed Phase 1, findings A1/A2).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { readValuePrimitive, clickBySelectorPrimitive } from './page-primitives';
import { REDACTED_VALUE, readScrubbedText } from '../core/redaction';

afterEach(() => {
  document.body.innerHTML = '';
});

function read(selector: string) {
  const r = readValuePrimitive(selector, undefined, {});
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

describe('readValuePrimitive — which property is the value', () => {
  it('an <li> reads its text, not the numeric .value property', () => {
    document.body.innerHTML = '<ul><li id="row">session alpha</li></ul>';
    expect(read('#row')).toMatchObject({ value: 'session alpha', length: 13 });
  });

  it('a <button> with no value attribute reads its text', () => {
    document.body.innerHTML = '<button id="b">Save draft</button>';
    expect(read('#b').value).toBe('Save draft');
  });

  it('a <button> that carries a value attribute reads that value', () => {
    document.body.innerHTML = '<button id="b" value="/rename">Rename session</button>';
    expect(read('#b').value).toBe('/rename');
  });

  it('a <progress> reads its text, never a number', () => {
    document.body.innerHTML = '<progress id="p" value="3" max="10">30%</progress>';
    const { value } = read('#p');
    expect(typeof value).toBe('string');
    expect(value).toBe('30%');
  });

  it('form fields keep reading .value, including the empty string', () => {
    document.body.innerHTML =
      '<input id="i" value="abc"><input id="e" value=""><textarea id="t">note</textarea>' +
      '<select id="s"><option value="x">X</option><option value="y" selected>Y</option></select>';
    expect(read('#i').value).toBe('abc');
    expect(read('#e').value).toBe('');
    expect(read('#t').value).toBe('note');
    expect(read('#s').value).toBe('y');
  });

  it('a password input is still redacted', () => {
    document.body.innerHTML = '<input id="pw" type="password" value="hunter2">';
    expect(read('#pw').value).toBe(REDACTED_VALUE);
  });
});

describe('ancestor selection does not read through a redaction boundary', () => {
  const page =
    '<div id="card">Token: <span data-bridge-redact="true">tok-SECRET-123</span> (expires soon)</div>';

  it('read-value of the containing element replaces the boundary with the sentinel', () => {
    document.body.innerHTML = page;
    const { value } = read('#card');
    expect(value).not.toContain('tok-SECRET-123');
    expect(value).toBe(`Token: ${REDACTED_VALUE} (expires soon)`);
  });

  it('read-value of a page-level wrapper does not leak the boundary text', () => {
    document.body.innerHTML = `<main id="app"><section>${page}</section></main>`;
    expect(read('#app').value).not.toContain('tok-SECRET-123');
  });

  it('nested boundaries collapse to one sentinel each, at the outermost', () => {
    document.body.innerHTML =
      '<div id="c">a<div data-bridge-redact="true">x<span data-bridge-redact="true">y</span>z</div>b</div>';
    expect(read('#c').value).toBe(`a${REDACTED_VALUE}b`);
  });

  it('the click echo of a containing element is scrubbed too', () => {
    document.body.innerHTML = page;
    const r = clickBySelectorPrimitive('#card', undefined, () => {});
    expect(r.ok && r.data.element.text).toBe(`Token: ${REDACTED_VALUE} (expires soon)`);
  });

  it('an element with no boundary below it reads plain textContent', () => {
    document.body.innerHTML = '<div id="d">  plain   text </div>';
    expect(readScrubbedText(document.getElementById('d'))).toBe('plain   text');
  });

  it('an element inside a boundary still reads the bare sentinel', () => {
    document.body.innerHTML = page;
    expect(readScrubbedText(document.querySelector('span'))).toBe(REDACTED_VALUE);
  });
});
