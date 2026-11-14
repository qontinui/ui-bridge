/**
 * Design tokens as a page uses them (`ai/design-tokens.ts`).
 *
 * A tokenised page declares its tokens on `:root` and consumes them with
 * `var()`. Reading only the custom properties declared ON an element found
 * none on all 279 elements of a real shop page, and the quality metric then
 * called every colour hardcoded (bridge caveat db2c8942). These tests pin the
 * three things that make token use measurable: root tokens reported once per
 * batch, per-element overrides of them, and per-property attribution — and
 * that `customPropertyConsistency` reads the attribution.
 *
 * jsdom neither inherits custom properties nor substitutes `var()` in computed
 * values. Where a test needs the browser's inheritance it says so and stands
 * it in (`inheritCustomProperties`); the attribution reads declarations, so
 * it holds either way.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getElementDesignData, indexCustomProperties } from '../design-inspector';
import { normalizedForms, rootTokensOf } from '../design-tokens';
import { collectDesignBatch } from '../../specs/quality-request';
import { customPropertyConsistency } from '../../specs/quality-metrics';
import { REDACTED_VALUE } from '../../core/redaction';
import type { ElementDesignData } from '../../core/types';

/** A browser inherits custom properties; jsdom does not. Stand inheritance in. */
function inheritCustomProperties(): void {
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    const computed = real(el, pseudo);
    const own = computed.getPropertyValue.bind(computed);
    computed.getPropertyValue = (prop: string): string => {
      const value = own(prop);
      if (value || !prop.startsWith('--') || !(el as Element).parentElement) return value;
      return window.getComputedStyle((el as Element).parentElement!).getPropertyValue(prop);
    };
    return computed;
  });
}

describe('design tokens', () => {
  let style: HTMLStyleElement;
  let host: HTMLDivElement;

  function add(tag: string, className: string, parent: Element = host): HTMLElement {
    const el = document.createElement(tag);
    el.className = className;
    parent.appendChild(el);
    return el;
  }

  function read(el: HTMLElement, all: HTMLElement[] = [el]): ElementDesignData {
    return getElementDesignData(el, {
      elementId: el.className,
      customProperties: indexCustomProperties(document, all),
    });
  }

  beforeEach(() => {
    style = document.createElement('style');
    style.textContent = [
      ':root { --brand: rgb(31, 78, 140); --hex: #1f4e8c; --space: 4px; --fs: 1rem; }',
      '.scope { --brand: rgb(200, 0, 0); }',
      '.btn { background: var(--brand); color: var(--brand); padding-left: var(--space); }',
      '.lit { background: rgb(1, 2, 3); color: rgb(31, 78, 140); }',
      '@media (min-width: 1px) { .m { font-size: var(--fs); } }',
    ].join('\n');
    document.head.appendChild(style);
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    style.remove();
    host.remove();
  });

  it('reports the root tokens once for the batch, with their root values', () => {
    const btn = add('button', 'btn');
    const index = indexCustomProperties(document, [btn]);
    expect(rootTokensOf(index.tokens)).toEqual({
      tokens: {
        '--brand': 'rgb(31, 78, 140)',
        '--hex': '#1f4e8c',
        '--space': '4px',
        '--fs': '1rem',
      },
      tokenCount: 4,
    });
    // Not repeated per element: the button declares none and overrides none.
    expect(read(btn).customProperties).toBeUndefined();
  });

  it('adds the tokens an ancestor re-declares, and only those that differ from the root', () => {
    inheritCustomProperties();
    const scope = add('section', 'scope');
    const inner = add('span', 'inner', scope);
    const outside = add('span', 'outside');
    expect(read(inner, [inner, outside]).customProperties).toEqual({
      '--brand': 'rgb(200, 0, 0)',
    });
    expect(read(outside, [inner, outside]).customProperties).toBeUndefined();
  });

  it('attributes a var() declaration as derived, including shorthands and grouping rules', () => {
    const btn = add('button', 'btn m');
    btn.style.setProperty('margin-left', 'var(--space)');
    const { tokenMatches } = read(btn);
    expect(tokenMatches?.backgroundColor).toEqual({ derived: ['--brand'] });
    expect(tokenMatches?.color?.derived).toEqual(['--brand']);
    expect(tokenMatches?.paddingLeft?.derived).toEqual(['--space']);
    expect(tokenMatches?.fontSize?.derived).toEqual(['--fs']);
    // Inline declarations count too.
    expect(tokenMatches?.marginLeft?.derived).toEqual(['--space']);
  });

  it('attributes an equal value as matches only, normalising hex colours', () => {
    const lit = add('div', 'lit');
    const { tokenMatches } = read(lit);
    expect(tokenMatches?.color).toEqual({ matches: ['--brand', '--hex'] });
    // rgb(1, 2, 3) is no token's value: no attribution at all.
    expect(tokenMatches?.backgroundColor).toBeUndefined();
    expect(tokenMatches).not.toHaveProperty('paddingLeft');
  });

  it('normalises colours and rem lengths the way a computed value reads', () => {
    expect(normalizedForms('#1F4E8C', 16)).toContain('rgb(31, 78, 140)');
    expect(normalizedForms('#1f4e8c80', 16)).toContain('rgba(31, 78, 140, 0.502)');
    expect(normalizedForms('rgb(31 78 140 / 50%)', 16)).toContain('rgba(31, 78, 140, 0.5)');
    expect(normalizedForms('1.5rem', 16)).toContain('24px');
  });

  it('customPropertyConsistency: a var() background is token use, a literal one is hardcoded', () => {
    const btn = add('button', 'btn');
    const lit = add('div', 'lit');
    const batch = collectDesignBatch([
      { id: 'btn', element: btn, type: 'button' },
      { id: 'lit', element: lit, type: 'generic' },
    ]);
    const metric = customPropertyConsistency(batch.elements, { width: 1280, height: 800 });
    // btn: background and colour both var(--brand). lit: a literal background
    // (hardcoded) and a colour equal to --brand (token-backed by value).
    expect(metric.rawData).toMatchObject({
      tokenBackedColors: 3,
      hardcodedColors: 1,
      totalColorProps: 4,
      elementsWithVars: 2,
      tokenAttribution: true,
    });
    expect(batch.tokens['--brand']).toBe('rgb(31, 78, 140)');
  });

  it('customPropertyConsistency: an unpainted (transparent) background is not a hardcoded colour', () => {
    // The shop page's "558 hardcoded colours" were 279 elements x (colour +
    // default transparent background): transparent is not a colour choice.
    const els = [add('div', 'a'), add('div', 'b')];
    for (const el of els) el.style.setProperty('color', 'var(--brand)');
    const batch = collectDesignBatch(els.map((element, i) => ({ id: `e${i}`, element })));
    expect(batch.elements.map((e) => e.styles.backgroundColor)).toEqual([
      'rgba(0, 0, 0, 0)',
      'rgba(0, 0, 0, 0)',
    ]);
    const metric = customPropertyConsistency(batch.elements, { width: 1280, height: 800 });
    expect(metric.rawData).toMatchObject({
      totalColorProps: 2,
      tokenBackedColors: 2,
      hardcodedColors: 0,
    });
  });

  it('a redacted element’s overrides stay scrubbed; root tokens are design data', () => {
    inheritCustomProperties();
    const scope = add('section', 'scope');
    scope.setAttribute('data-bridge-redact', 'true');
    const inner = add('span', 'inner', scope);
    const index = indexCustomProperties(document, [inner]);
    const data = getElementDesignData(inner, { customProperties: index });
    expect(data.customProperties).toEqual({ '--brand': REDACTED_VALUE });
    expect(rootTokensOf(index.tokens).tokens['--brand']).toBe('rgb(31, 78, 140)');
  });
});
