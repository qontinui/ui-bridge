/**
 * `textOutsideBoundaries` reads RENDERED text: <script>, <style>, <template>,
 * <noscript>, `hidden` and display:none subtrees are skipped, on the plain
 * path and under a boundary index alike, and redaction is unchanged.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { REDACTED_VALUE, textOutsideBoundaries, withBoundaryIndex } from './redaction';

afterEach(() => {
  document.body.innerHTML = '';
});

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

const NON_RENDERED = `<script>var token = "S1";</script><style>.x{color:red}</style>
<template><b>T1</b></template><noscript>N1</noscript><p hidden>H1</p>
<p style="display:none">D1</p>`;

describe('textOutsideBoundaries skips non-rendered text', () => {
  it('without a boundary', () => {
    const root = mount(`<span>shown</span>${NON_RENDERED}<span>-too</span>`);
    expect(textOutsideBoundaries(root)?.replace(/\s+/g, '')).toBe('shown-too');
  });

  it('skips display:none that comes from a stylesheet', () => {
    const style = document.createElement('style');
    style.textContent = '.gone{display:none}';
    document.head.appendChild(style);
    const root = mount('<span>a</span><div class="gone">X</div><span>b</span>');
    expect(textOutsideBoundaries(root)).toBe('ab');
    style.remove();
  });

  it('with a boundary, plain and indexed paths agree and redaction holds', () => {
    const root = mount(
      `<span>a</span>${NON_RENDERED}<i data-bridge-redact="true">SECRET</i><span>b</span>`
    );
    const plain = textOutsideBoundaries(root);
    const indexed = withBoundaryIndex(document.body, () => textOutsideBoundaries(root));
    expect(plain?.replace(/\s+/g, '')).toBe(`a${REDACTED_VALUE}b`);
    expect(indexed).toBe(plain);
    expect(plain).not.toContain('SECRET');
  });

  it('a boundary inside a hidden subtree leaks nothing and adds no sentinel', () => {
    const root = mount('<span>a</span><div hidden><i data-bridge-redact="true">SECRET</i></div>');
    expect(textOutsideBoundaries(root)).toBe('a');
  });

  it('a boundary inside a rendered nested element is still redacted when a sibling is hidden', () => {
    const root = mount(
      '<div><p hidden>H</p><b data-bridge-redact="true">SECRET</b></div><span>z</span>'
    );
    const indexed = withBoundaryIndex(document.body, () => textOutsideBoundaries(root));
    expect(indexed).toBe(`${REDACTED_VALUE}z`);
  });
});
