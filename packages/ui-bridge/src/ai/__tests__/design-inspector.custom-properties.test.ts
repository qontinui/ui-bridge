/**
 * CSS custom properties, read rule-first for a batch.
 *
 * `getCSSCustomProperties(el)` matches one element against every top-level
 * style rule. Over a batch that is elements × rules `matches()` calls: on
 * qontinui.io's production stylesheets with 1,120 registered elements it was
 * 184,800 calls and about 43 ms of every `/design/evaluate` (plan
 * 2026-10-13-image-generation-and-visual-judgment, Phase 6 fix round, measured
 * in headless Chromium). `indexCustomProperties` reads the rules once, keeps
 * the ones that declare a custom property, and queries each of them once.
 *
 * These tests pin the two halves of that: the index answers what the
 * per-element walk answers, key order included, for every kind of element;
 * and it gets there with one `querySelectorAll` per declaring rule and no
 * per-element matching.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCSSCustomProperties, indexCustomProperties } from '../design-inspector';

describe('indexCustomProperties', () => {
  let style: HTMLStyleElement;
  let root: HTMLDivElement;

  function div(className: string, parent: Node | null = root): HTMLDivElement {
    const el = document.createElement('div');
    el.className = className;
    parent?.appendChild(el);
    return el;
  }

  beforeEach(() => {
    style = document.createElement('style');
    style.textContent = [
      ':root { --brand: #123456; }',
      '.card { --pad: 8px; color: red; }',
      '.plain { color: blue; }',
      '.card.big { --pad: 12px; --gap: 4px; }',
      '.x::before { --pseudo: 1; }',
      // Grouping rules are outside the walk's scope, with or without an index.
      '@media (min-width: 1px) { .card { --media: 1; } }',
    ].join('\n');
    document.head.appendChild(style);
    // A selector no engine parses: both paths skip it.
    const sheet = style.sheet as CSSStyleSheet;
    sheet.insertRule('.card:no-such-pseudo { --never: 1; }', sheet.cssRules.length);
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    style.remove();
    root.remove();
  });

  it('answers what the per-element walk answers, for every kind of element', () => {
    const card = div('card');
    const big = div('card big');
    big.style.setProperty('--inline', '3');
    const plain = div('plain');
    const outOfScope = div('card');
    const detached = div('card', null);
    const host = div('host');
    const inShadow = div('card', host.attachShadow({ mode: 'open' }));
    const html = document.documentElement;

    const all = [card, big, plain, outOfScope, detached, inShadow, html];
    const index = indexCustomProperties(document, [card, big, plain, detached, inShadow, html]);
    for (const el of all) {
      expect(Object.entries(getCSSCustomProperties(el, index))).toEqual(
        Object.entries(getCSSCustomProperties(el))
      );
    }

    // Not vacuous: the walk finds inline and rule-declared properties, in order.
    expect(Object.entries(getCSSCustomProperties(big, index))).toEqual([
      ['--inline', '3'],
      ['--pad', '12px'],
      ['--gap', '4px'],
    ]);
    expect(getCSSCustomProperties(html, index)).toEqual({ '--brand': '#123456' });
    expect(getCSSCustomProperties(card, index)).toEqual({ '--pad': '8px' });
    expect(getCSSCustomProperties(plain, index)).toEqual({});
    // Outside the indexed document or scope, the element is matched rule by rule.
    expect(getCSSCustomProperties(outOfScope, index)).toEqual({ '--pad': '8px' });
    expect(Object.keys(getCSSCustomProperties(inShadow, index))).toEqual(['--pad']);
    expect(Object.keys(getCSSCustomProperties(detached, index))).toEqual(['--pad']);
  });

  it('queries each rule that declares a custom property once, and matches no element', () => {
    const elements = [div('card'), div('card big'), div('plain'), div('card'), div('plain')];
    const sheets = vi.spyOn(document, 'styleSheets', 'get');
    const query = vi.spyOn(document, 'querySelectorAll');
    const matches = vi.spyOn(Element.prototype, 'matches');

    const index = indexCustomProperties(document, elements);
    const found = elements.map((el) => getCSSCustomProperties(el, index));

    expect(sheets).toHaveBeenCalledTimes(1);
    // `.plain` declares no custom property, so it is never queried.
    expect(query.mock.calls.map(([selector]) => selector)).toEqual([
      ':root',
      '.card',
      '.card.big',
      '.x::before',
      '.card:no-such-pseudo',
    ]);
    expect(matches).not.toHaveBeenCalled();
    expect(found.map((props) => Object.keys(props))).toEqual([
      ['--pad'],
      ['--pad', '--gap'],
      [],
      ['--pad'],
      [],
    ]);
  });
});
