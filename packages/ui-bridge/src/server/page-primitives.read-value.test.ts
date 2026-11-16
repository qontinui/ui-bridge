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
import {
  readValuePrimitive,
  clickBySelectorPrimitive,
  clickByTextPrimitive,
  findByTextPrimitive,
} from './page-primitives';
import { REDACTED_VALUE, readScrubbedText } from '../core/redaction';
import { computeElementFingerprint } from '../core/element-fingerprint';
import {
  computeAccessibleNameSafe,
  computeVisibleText,
  resolveAccessibleName,
} from '../core/a11y';

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

describe('the value of elements whose .value is not a value', () => {
  it('an <output> reads its scrubbed text, not .value (which is its raw text)', () => {
    document.body.innerHTML =
      '<output id="o">x <span data-bridge-redact="true">SECRET-OUT</span></output>';
    expect(read('#o').value).toBe(`x ${REDACTED_VALUE}`);
  });

  it('an <option value=""> reads "", agreeing with its <select>', () => {
    document.body.innerHTML =
      '<select id="s"><option id="ph" value="" selected>Choose one</option></select>';
    expect(read('#ph').value).toBe('');
    expect(read('#s').value).toBe('');
  });

  it('a <data value="..."> reads its attribute', () => {
    document.body.innerHTML = '<data id="d" value="42">forty-two</data>';
    expect(read('#d').value).toBe('42');
  });
});

describe('text search is no confirmation oracle for redacted text', () => {
  const page =
    '<main id="app"><div id="card">Token: <span data-bridge-redact="true">tok-SECRET-123</span> (expires)</div></main>';

  it('findByText for the secret finds nothing, not even an ancestor', () => {
    document.body.innerHTML = page;
    const right = findByTextPrimitive('tok-SECRET-123', {});
    const wrong = findByTextPrimitive('tok-WRONG-999', {});
    expect(right.ok && right.data).toEqual([]);
    expect(wrong.ok && wrong.data).toEqual([]);
  });

  it('findByText still finds the non-redacted text of the container', () => {
    document.body.innerHTML = page;
    const r = findByTextPrimitive('(expires)', { exact: false });
    expect(r.ok && r.data.map((h) => h.text)).toContain(`Token: ${REDACTED_VALUE} (expires)`);
  });

  it('clickByText for the secret answers not-found and clicks nothing', () => {
    document.body.innerHTML = page;
    let clicked = 0;
    const r = clickByTextPrimitive('tok-SECRET-123', {}, () => {
      clicked += 1;
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe('ELEMENT_NOT_FOUND');
    expect(clicked).toBe(0);
  });

  it('visible text and a content-derived accessible name exclude the boundary', () => {
    document.body.innerHTML =
      '<button id="b">Copy <span data-bridge-redact="true">tok-SECRET-123</span></button>';
    const b = document.getElementById('b')!;
    expect(computeVisibleText(b)).toBe(`Copy ${REDACTED_VALUE}`);
    expect(resolveAccessibleName(b).name ?? '').not.toContain('tok-SECRET-123');
  });

  it('an aria-label name is the element\'s own and stays', () => {
    document.body.innerHTML =
      '<button id="b" aria-label="Copy token"><span data-bridge-redact="true">tok-SECRET-123</span></button>';
    expect(resolveAccessibleName(document.getElementById('b')!)).toMatchObject({
      name: 'Copy token',
      source: 'aria-label',
    });
  });
});

describe('truncation never splits the sentinel', () => {
  it('a cut inside the sentinel drops it whole', () => {
    document.body.innerHTML = '<div id="t">ab<span data-bridge-redact="true">x</span>cd</div>';
    expect(readScrubbedText(document.getElementById('t'), undefined, { maxLen: 5 })).toBe('ab');
    expect(readScrubbedText(document.getElementById('t'), undefined, { maxLen: 12 })).toBe(
      `ab${REDACTED_VALUE}`
    );
  });
});

describe('accessible names read from labels exclude redaction boundaries', () => {
  it.each([
    [
      '<label for>',
      '<label for="x">Card <span data-bridge-redact="true">4111</span></label><input id="x">',
      'label',
    ],
    [
      'a wrapping <label>',
      '<label>Card <span data-bridge-redact="true">4111</span><input id="x"></label>',
      'label',
    ],
    [
      'aria-labelledby',
      '<p id="l">Card <b data-bridge-redact="true">4111</b></p><input id="x" aria-labelledby="l">',
      'aria-labelledby',
    ],
  ])('%s: the name carries the sentinel, not the boundary text', (_c, html, source) => {
    document.body.innerHTML = html;
    const input = document.getElementById('x')!;
    expect(computeAccessibleNameSafe(input)).toBe(`Card ${REDACTED_VALUE}`);
    expect(resolveAccessibleName(input)).toEqual({ name: `Card ${REDACTED_VALUE}`, source });
  });

  it('a labelledby target INSIDE a boundary reads as the bare sentinel', () => {
    document.body.innerHTML =
      '<div data-bridge-redact="true"><p id="l">PIN 9876</p></div><input id="x" aria-labelledby="l">';
    expect(computeAccessibleNameSafe(document.getElementById('x')!)).toBe(REDACTED_VALUE);
  });

  it('with no boundary in reach the W3C name is untouched', () => {
    document.body.innerHTML = '<label for="x">Email address</label><input id="x">';
    expect(resolveAccessibleName(document.getElementById('x')!)).toEqual({
      name: 'Email address',
      source: 'label',
    });
  });
});

describe('more than one label, and fingerprints', () => {
  it('a boundary in the SECOND label[for] is excluded too', () => {
    document.body.innerHTML =
      '<label for="x">Card</label><label for="x"><span data-bridge-redact="true">4111</span></label><input id="x">';
    const name = computeAccessibleNameSafe(document.getElementById('x')!) ?? '';
    expect(name).not.toContain('4111');
    expect(name).toBe(`Card ${REDACTED_VALUE}`);
  });

  it.each([
    ['a button holding a boundary', '<button id="t">Reveal <span data-bridge-redact="true">tok-SECRET</span></button>'],
    ['an input labelled into a boundary', '<p id="l">Code <b data-bridge-redact="true">tok-SECRET</b></p><input id="t" aria-labelledby="l">'],
    ['an input with a label[for] holding a boundary', '<label for="t">Code <b data-bridge-redact="true">tok-SECRET</b></label><input id="t">'],
    ['a button INSIDE a boundary', '<div data-bridge-redact="true"><button id="t">tok-SECRET</button></div>'],
  ])('%s: the fingerprint carries no boundary text', (_c, html) => {
    document.body.innerHTML = html;
    const fp = computeElementFingerprint(document.getElementById('t')!);
    expect(JSON.stringify(fp)).not.toContain('tok-SECRET');
  });
});

describe('fingerprints of an element inside a boundary', () => {
  it.each([
    ['aria-label', '<div data-bridge-redact="true"><button id="t" aria-label="Copy tok-SECRET">c</button></div>'],
    ['placeholder', '<div data-bridge-redact="true"><input id="t" placeholder="tok-SECRET"></div>'],
  ])('its %s never reaches the fingerprint', (_c, html) => {
    document.body.innerHTML = html;
    expect(JSON.stringify(computeElementFingerprint(document.getElementById('t')!))).not.toContain('tok-SECRET');
  });
});

describe('a boundary-adjacent name is the real W3C name over a boundary-free clone', () => {
  it('keeps descendant <img alt>, omits aria-hidden text, and shows the sentinel for the boundary', () => {
    document.body.innerHTML =
      '<button id="b"><img alt="Logo" src="x.png"><span aria-hidden="true">HIDDEN-TEXT</span>Pay <span data-bridge-redact="true">tok-SECRET <img alt="IMG-SECRET"></span></button>';
    const b = document.getElementById('b')!;
    const name = computeAccessibleNameSafe(b) ?? '';
    expect(name).toBe(`Logo Pay ${REDACTED_VALUE}`);
    expect(name).not.toContain('HIDDEN-TEXT');
    expect(name).not.toContain('SECRET');
    expect(resolveAccessibleName(b)).toEqual({ name: `Logo Pay ${REDACTED_VALUE}`, source: 'text' });
  });

  it('reads an embedded control value but never a boundary-held one', () => {
    document.body.innerHTML =
      '<div role="button" id="x">Qty <input id="q" type="text"> <input id="p" type="text" data-bridge-redact="true"></div>';
    (document.getElementById('q') as HTMLInputElement).value = '7';
    (document.getElementById('p') as HTMLInputElement).value = 'tok-SECRET';
    const name = computeAccessibleNameSafe(document.getElementById('x')!) ?? '';
    expect(name).not.toContain('tok-SECRET');
    expect(name).toContain('7');
  });

  it('a labelledby chain through a boundary emits the sentinel, not its text', () => {
    document.body.innerHTML =
      '<span id="a">Card</span><div id="c"><b data-bridge-redact="true">4111</b><i aria-hidden="true">nope</i></div><input id="x" aria-labelledby="a c">';
    const name = computeAccessibleNameSafe(document.getElementById('x')!) ?? '';
    expect(name).toBe(`Card ${REDACTED_VALUE}`);
  });

  it('never mutates the live DOM', () => {
    document.body.innerHTML =
      '<label for="x">Card <span data-bridge-redact="true">4111</span></label><button id="x">Go <span data-bridge-redact="true">tok</span></button>';
    const before = document.body.innerHTML;
    computeAccessibleNameSafe(document.getElementById('x')!);
    expect(document.body.innerHTML).toBe(before);
  });
});
