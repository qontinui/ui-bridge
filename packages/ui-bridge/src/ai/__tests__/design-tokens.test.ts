/**
 * Design tokens as a page uses them (`ai/design-tokens.ts`): root tokens and
 * scopes reported once per batch, per-property attribution (`derived`,
 * `overridden`, `matches`, `inherited`), and `customPropertyConsistency`
 * reading that attribution.
 *
 * jsdom's CSSOM leaves a shorthand's longhands empty when it is written with
 * `var()`, as browsers do, but its computed style substitutes no `var()` and
 * drops a `var()` shorthand. Where a test needs the value a browser computes,
 * it states that value (`browserComputes`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getElementDesignData, indexCustomProperties } from '../design-inspector';
import {
  MAX_TOKEN_VALUE_LENGTH,
  normalizedForms,
  referencesOf,
  reportedTokensOf,
} from '../design-tokens';
import { normalizeColor } from '../css-color';
import { emptyCoverage, resolveNestedSelector, styleRules } from '../stylesheet-walk';
import { collectDesignBatch } from '../../specs/quality-request';
import { customPropertyConsistency } from '../../specs/quality-metrics';
import { REDACTED_VALUE } from '../../core/redaction';
import type { ElementDesignData } from '../../core/types';

/** State the computed values a browser would give these elements (kebab-case properties). */
function browserComputes(values: Map<Element, Record<string, string>>): void {
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    const computed = real(el, pseudo);
    const stated = values.get(el as Element);
    if (!stated || pseudo) return computed;
    const own = computed.getPropertyValue.bind(computed);
    return new Proxy(computed, {
      get(target, key) {
        if (key === 'getPropertyValue') return (p: string) => stated[p] ?? own(p);
        if (key === 'fontSize' && stated['font-size']) return stated['font-size'];
        const value = Reflect.get(target, key) as unknown;
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });
  });
}

const VIEWPORT = { width: 1280, height: 800 };

describe('design tokens', () => {
  let style: HTMLStyleElement;
  let host: HTMLDivElement;

  function add(tag: string, className: string, parent: Element = host): HTMLElement {
    const el = document.createElement(tag);
    el.className = className;
    parent.appendChild(el);
    return el;
  }

  function sheet(...rules: string[]): void {
    style.textContent = rules.join('\n');
  }

  function read(el: HTMLElement, all: HTMLElement[] = [el, host]): ElementDesignData {
    return getElementDesignData(el, {
      elementId: el.className,
      customProperties: indexCustomProperties(document, all),
    });
  }

  beforeEach(() => {
    style = document.createElement('style');
    document.head.appendChild(style);
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    style.remove();
    host.remove();
    document.documentElement.removeAttribute('style');
  });

  // ------------------------------------------------------------ reporting

  it('reports root tokens once with their family and where the family came from', () => {
    sheet(
      ':root { --brand: rgb(31, 78, 140); --space-4: 16px; --blue-500: #00f; --misc: 3; }',
      '.btn { color: var(--brand); }'
    );
    const btn = add('button', 'btn');
    const { tokens, tokenCount } = reportedTokensOf(indexCustomProperties(document, [btn]).tokens);
    expect(tokenCount).toBe(4);
    expect(tokens).toEqual({
      '--brand': {
        value: 'rgb(31, 78, 140)',
        families: ['color'],
        familyFrom: 'usage',
        from: 'stylesheet',
      },
      '--space-4': { value: '16px', families: ['space'], familyFrom: 'name', from: 'stylesheet' },
      '--blue-500': { value: '#00f', families: ['color'], familyFrom: 'value', from: 'stylesheet' },
      '--misc': { value: '3', families: [], familyFrom: 'none', from: 'stylesheet' },
    });
    // Not repeated per element.
    expect(read(btn).customProperties).toBeUndefined();
  });

  it('caps a long token value and counts it', () => {
    const uri = `url("data:image/svg+xml,${'x'.repeat(400)}")`;
    sheet(`:root { --icon: ${uri}; --ok: 1px; }`);
    const reported = reportedTokensOf(indexCustomProperties(document, [host]).tokens);
    expect(reported.tokens['--icon'].value).toHaveLength(
      MAX_TOKEN_VALUE_LENGTH + '…[truncated]'.length
    );
    expect(reported.tokens['--icon'].value.endsWith('…[truncated]')).toBe(true);
    expect(reported.truncatedValues).toBe(1);
  });

  it('reports a root INLINE custom property by name, keeping only colours and lengths', () => {
    sheet(':root { --brand: rgb(31, 78, 140); }');
    const root = document.documentElement;
    root.style.setProperty('--display-name', 'Alice');
    root.style.setProperty('--avatar', 'url("https://cdn.test/a.png?token=x")');
    root.style.setProperty('--accent', '#ff0000');
    root.style.setProperty('--gutter', '12px');
    const { tokens } = reportedTokensOf(indexCustomProperties(document, [host]).tokens);
    expect(tokens['--display-name']).toMatchObject({ value: REDACTED_VALUE, from: 'inline' });
    expect(tokens['--avatar']).toMatchObject({ value: REDACTED_VALUE, from: 'inline' });
    expect(tokens['--accent']).toMatchObject({ value: '#ff0000', from: 'inline' });
    expect(tokens['--gutter']).toMatchObject({ value: '12px', from: 'inline' });
    expect(tokens['--brand']).toMatchObject({ value: 'rgb(31, 78, 140)', from: 'stylesheet' });
  });

  it('reports a theme scope once; its descendants name it instead of repeating its values', () => {
    sheet(':root { --brand: rgb(31, 78, 140); }', '.theme { --brand: rgb(200, 0, 0); }');
    const theme = add('div', 'theme');
    theme.setAttribute('data-theme', 'dark');
    const kids = [add('span', 'a', theme), add('span', 'b', theme), add('span', 'c', theme)];
    const batch = collectDesignBatch(kids.map((element, i) => ({ id: `k${i}`, element })));
    expect(batch.scopes).toEqual({
      'scope-1': {
        element: 'div.theme[data-theme="dark"]',
        overrides: { '--brand': 'rgb(200, 0, 0)' },
      },
    });
    expect(batch.scopeCount).toBe(1);
    expect(batch.elements.map((e) => e.tokenScopes)).toEqual([
      ['scope-1'],
      ['scope-1'],
      ['scope-1'],
    ]);
    expect(batch.elements.every((e) => e.customProperties === undefined)).toBe(true);
  });

  it('a redacted scope’s overrides stay scrubbed; root tokens are design data', () => {
    sheet(':root { --brand: rgb(31, 78, 140); }', '.theme { --brand: rgb(200, 0, 0); }');
    const theme = add('div', 'theme');
    theme.setAttribute('data-bridge-redact', 'true');
    const batch = collectDesignBatch([{ id: 'k', element: add('span', 'k', theme) }]);
    expect(batch.scopes['scope-1'].overrides).toEqual({ '--brand': REDACTED_VALUE });
    expect(batch.tokens['--brand'].value).toBe('rgb(31, 78, 140)');
  });

  // ------------------------------------------------------- declarations

  it('expands a box shorthand per side: each side gets only its own token', () => {
    sheet('.p { padding: var(--s2) var(--s4); margin: var(--m1) var(--m2) var(--m3) var(--m4); }');
    const refs = referencesOf((style.sheet!.cssRules[0] as CSSStyleRule).style)!;
    const names = (p: string) => refs.get(p as never)?.names;
    expect([
      names('paddingTop'),
      names('paddingRight'),
      names('paddingBottom'),
      names('paddingLeft'),
    ]).toEqual([['--s2'], ['--s4'], ['--s2'], ['--s4']]);
    expect([
      names('marginTop'),
      names('marginRight'),
      names('marginBottom'),
      names('marginLeft'),
    ]).toEqual([['--m1'], ['--m2'], ['--m3'], ['--m4']]);
  });

  it('maps logical properties and longhands onto the attributed ones', () => {
    sheet(
      '.l { padding-inline: calc(var(--spacing) * 4); margin-block-start: var(--mb); ' +
        'border-top-left-radius: var(--r); row-gap: var(--g); border-top-color: var(--bc); color: var( --c); }'
    );
    const refs = referencesOf((style.sheet!.cssRules[0] as CSSStyleRule).style)!;
    expect(refs.get('paddingLeft')).toEqual({
      names: ['--spacing'],
      bare: false,
      ambiguous: false,
    });
    expect(refs.get('paddingRight')?.names).toEqual(['--spacing']);
    expect(refs.get('paddingTop')).toBeUndefined();
    expect(refs.get('marginTop')?.names).toEqual(['--mb']);
    expect(refs.get('borderRadius')?.names).toEqual(['--r']);
    expect(refs.get('gap')?.names).toEqual(['--g']);
    expect(refs.get('border')?.names).toEqual(['--bc']);
    expect(refs.get('color')).toEqual({ names: ['--c'], bare: true, ambiguous: false });
  });

  it('Tailwind-style calc() spacing is derived as an expression on both inline sides', () => {
    sheet(':root { --spacing: 0.25rem; }', '.tw { padding-inline: calc(var(--spacing) * 4); }');
    const el = add('div', 'tw');
    browserComputes(new Map([[el, { 'padding-left': '16px', 'padding-right': '16px' }]]));
    const { tokenMatches } = read(el);
    expect(tokenMatches?.paddingLeft).toEqual({ derived: ['--spacing'], expression: true });
    expect(tokenMatches?.paddingRight).toEqual({ derived: ['--spacing'], expression: true });
  });

  it('a gradient background token is not the background colour', () => {
    sheet(
      ':root { --gradient: linear-gradient(red, blue); --a: red; }',
      '.g { background: var(--gradient); }',
      '.g2 { background: var(--gradient) center / cover no-repeat; }',
      '.h { background: linear-gradient(var(--a), var(--a)); }'
    );
    expect(read(add('div', 'g')).tokenMatches?.backgroundColor).toBeUndefined();
    expect(read(add('div', 'g2')).tokenMatches?.backgroundColor).toBeUndefined();
    expect(referencesOf((style.sheet!.cssRules[3] as CSSStyleRule).style)).toBeNull();
  });

  it('a font shorthand token is not attributed to a longhand it did not produce', () => {
    sheet(':root { --font-body: 700 16px/1.5 Inter; }', '.f { font: var(--font-body); }');
    const el = add('p', 'f');
    browserComputes(new Map([[el, { 'font-size': '16px', 'font-weight': '700' }]]));
    const { tokenMatches } = read(el);
    expect(tokenMatches?.fontSize).toBeUndefined();
    expect(tokenMatches?.fontWeight).toBeUndefined();
  });

  it('a var() background shorthand is derived when the browser computed its value', () => {
    sheet(':root { --brand: rgb(31, 78, 140); }', '.btn { background: var(--brand); }');
    const btn = add('button', 'btn');
    browserComputes(new Map([[btn, { 'background-color': 'rgb(31, 78, 140)' }]]));
    expect(read(btn).tokenMatches?.backgroundColor).toEqual({ derived: ['--brand'] });
  });

  // ------------------------------------------------------ cascade checks

  it('a var() declaration that lost the cascade is overridden, not derived', () => {
    sheet(
      ':root { --brand: rgb(31, 78, 140); }',
      '.btn { color: var(--brand); }',
      '.btn.special { color: rgb(1, 2, 3); }'
    );
    const btn = add('button', 'btn special');
    browserComputes(new Map([[btn, { color: 'rgb(1, 2, 3)' }]]));
    expect(read(btn).tokenMatches?.color).toEqual({ overridden: ['--brand'] });
  });

  it('an inherited property is derived via an ancestor that declares it with var()', () => {
    sheet(':root { --brand: rgb(31, 78, 140); }', '.card { color: var(--brand); }');
    const card = add('section', 'card');
    const mid = add('div', 'mid', card);
    const text = add('span', 'text', mid);
    const own = add('span', 'own', mid);
    const brand = { color: 'rgb(31, 78, 140)' };
    browserComputes(
      new Map<Element, Record<string, string>>([
        [card, brand],
        [mid, brand],
        [text, brand],
        [own, { color: 'rgb(9, 9, 9)' }],
      ])
    );
    const index = indexCustomProperties(document, [text, own]);
    const at = (el: HTMLElement) =>
      getElementDesignData(el, { customProperties: index }).tokenMatches;
    expect(at(text)?.color).toEqual({ derived: ['--brand'], via: 'inherited' });
    // A different value is not inherited, so not derived.
    expect(at(own)?.color).toBeUndefined();
  });

  it('a colour inherited unchanged from no token is marked inherited, and matches nothing', () => {
    sheet(':root { --ink: rgb(0, 0, 0); --x: 1px; }', '.p { color: var(--x); }');
    const parent = add('div', 'parent');
    const child = add('span', 'child', parent);
    const black = { color: 'rgb(0, 0, 0)' };
    browserComputes(
      new Map<Element, Record<string, string>>([
        [parent, black],
        [child, black],
      ])
    );
    expect(read(child, [child]).tokenMatches?.color).toEqual({ inherited: true });
  });

  // ----------------------------------------------------------- matches

  it('matches only tokens of a compatible family', () => {
    sheet(
      ':root { --space-4: 16px; --radius-lg: 8px; }',
      '.uses { padding: var(--space-4); border-radius: var(--radius-lg); }',
      '.lit { font-size: 16px; padding-left: 16px; padding-top: 8px; }'
    );
    add('div', 'uses');
    const lit = add('div', 'lit');
    const { tokenMatches } = read(lit);
    expect(tokenMatches?.fontSize).toBeUndefined();
    expect(tokenMatches?.paddingLeft).toEqual({ matches: ['--space-4'] });
    // 8px is a radius token, not a space one.
    expect(tokenMatches?.paddingTop).toBeUndefined();
  });

  it('compares a unitless line-height token through the element’s font size', () => {
    sheet(':root { --leading-normal: 1.5; }', '.t { font-size: 16px; line-height: 24px; }');
    const el = add('p', 't');
    browserComputes(new Map([[el, { 'font-size': '16px', 'line-height': '24px' }]]));
    expect(read(el).tokenMatches?.lineHeight).toEqual({ matches: ['--leading-normal'] });
  });

  it('caps matches at 8 names and counts them all', () => {
    const aliases = Array.from({ length: 10 }, (_, i) => `--color-alias-${i}: rgb(1, 2, 3);`);
    sheet(`:root { ${aliases.join(' ')} }`, '.lit { color: rgb(1, 2, 3); }');
    const lit = add('div', 'lit');
    browserComputes(
      new Map([
        [lit, { color: 'rgb(1, 2, 3)' }],
        [host, { color: 'rgb(0, 0, 0)' }],
      ])
    );
    const color = read(lit).tokenMatches?.color;
    expect(color?.matches).toHaveLength(8);
    expect(color?.matchCount).toBe(10);
  });

  it('normalises colours and lengths the way a browser serialises them', () => {
    expect(normalizeColor('#1F4E8C')).toBe('rgb(31, 78, 140)');
    expect(normalizeColor('#1f4e8c80')).toBe('rgba(31, 78, 140, 0.5)');
    expect(normalizeColor('#1f4e8c81')).toBe('rgba(31, 78, 140, 0.506)');
    expect(normalizeColor('rgb(31 78 140 / 50%)')).toBe('rgba(31, 78, 140, 0.5)');
    expect(normalizeColor('rgba(300, -5, 128, 0.502)')).toBe('rgba(255, 0, 128, 0.5)');
    expect(normalizeColor('hsl(210, 64%, 34%)')).toBe('rgb(31, 87, 142)');
    expect(normalizeColor('rebeccapurple')).toBe('rgb(102, 51, 153)');
    expect(normalizeColor('oklch(0.5 0.1 200)')).toBeNull();
    expect(normalizedForms('0.3rem', { rootFontPx: 16 })).toContain('4.8px');
    // 0.7 x 14 is 9.799999999999999 in floating point.
    expect(normalizedForms('0.7rem', { rootFontPx: 14 })).toEqual(['0.7rem', '9.8px']);
    expect(normalizedForms('1.5', { rootFontPx: 16, fontPx: 16, lineHeight: true })).toContain(
      '24px'
    );
  });

  // ------------------------------------------------------------ coverage

  it('a @media that does not match is skipped and counted', () => {
    window.matchMedia = ((query: string) => ({ matches: !query.includes('9999px') })) as never;
    sheet(
      ':root { --fs: 20px; --fs2: 30px; }',
      '@media (min-width: 9999px) { .m { font-size: var(--fs); } }',
      '@media (min-width: 1px) { .m { line-height: var(--fs2); } }'
    );
    const el = add('div', 'm');
    browserComputes(new Map([[el, { 'line-height': '30px' }]]));
    const index = indexCustomProperties(document, [el, host]);
    const data = getElementDesignData(el, { customProperties: index });
    expect(data.tokenMatches?.fontSize?.derived).toBeUndefined();
    expect(data.tokenMatches?.lineHeight?.derived).toEqual(['--fs2']);
    expect(reportedTokensOf(index.tokens).tokenCoverage.skippedRules.mediaNotMatching).toBe(1);
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it('skips and counts @supports false, @container, @scope and @starting-style', () => {
    const realCSS = globalThis.CSS;
    vi.stubGlobal('CSS', {
      escape: (v: string) => realCSS.escape(v),
      supports: (condition: string) => !condition.includes('nope'),
    });
    sheet(
      '@supports (nope: 1) { .s { color: var(--a); } }',
      '@supports (display: grid) { .g { color: var(--a); } }'
    );
    const unplaceable = {
      cssRules: [
        { cssText: '@container (min-width: 1px) { .c { color: red; } }', cssRules: [] },
        { cssText: '@scope (.a) { .b { color: red; } }', cssRules: [] },
        { cssText: '@starting-style { .t { color: red; } }', cssRules: [] },
      ],
    };
    vi.spyOn(document, 'styleSheets', 'get').mockReturnValue([style.sheet, unplaceable] as never);
    const coverage = emptyCoverage();
    const selectors = [...styleRules(document, { descend: true, coverage })].map((r) => r.selector);
    expect(selectors).toEqual(['.g']);
    expect(coverage.sheetsRead).toBe(2);
    expect(coverage.skippedRules).toEqual({
      container: 1,
      scope: 1,
      startingStyle: 1,
      mediaNotMatching: 0,
      supportsFalse: 1,
    });
  });

  it('resolves a nested rule’s selector against its parent', () => {
    expect(resolveNestedSelector('.card', '& .title, &:hover')).toBe(
      ':is(.card) .title, :is(.card):hover'
    );
    expect(resolveNestedSelector('.a, .b', '.c')).toBe(':is(.a, .b) .c');
  });

  it('flags an element the index never reached (a shadow tree) instead of attributing it', () => {
    sheet(':root { --brand: red; }', '.x { color: var(--brand); }');
    const shadowHost = add('div', 'shadow-host');
    const inner = document.createElement('span');
    inner.className = 'x';
    shadowHost.attachShadow({ mode: 'open' }).appendChild(inner);
    const data = getElementDesignData(inner, {
      customProperties: indexCustomProperties(document, [inner, host]),
    });
    expect(data.tokenAnalysis).toBe('uncovered');
    expect(data.tokenMatches).toBeUndefined();
  });

  it('indexes one element by matching rules against it and its ancestors, not by querying', () => {
    sheet(':root { --brand: red; }', '.x { color: var(--brand); }', '.y { --local: 1px; }');
    const el = add('span', 'x');
    const query = vi.spyOn(document, 'querySelectorAll');
    const index = indexCustomProperties(document, [el]);
    expect(query).not.toHaveBeenCalled();
    expect(index.tokens.references.get(el)?.get('color')?.names).toEqual(['--brand']);
  });

  // ------------------------------------------------------------- metric

  it('customPropertyConsistency counts derived as token use, matches-only as half, literals as hardcoded', () => {
    sheet(
      ':root { --brand: rgb(31, 78, 140); }',
      '.btn { background-color: var(--brand); }',
      '.lit { background-color: rgb(1, 2, 3); color: rgb(31, 78, 140); }'
    );
    const btn = add('button', 'btn');
    const lit = add('div', 'lit');
    browserComputes(
      new Map<Element, Record<string, string>>([
        [btn, { 'background-color': 'rgb(31, 78, 140)', color: 'rgb(0, 0, 0)' }],
        [lit, { 'background-color': 'rgb(1, 2, 3)', color: 'rgb(31, 78, 140)' }],
        [host, { color: 'rgb(0, 0, 0)' }],
      ])
    );
    const batch = collectDesignBatch([
      { id: 'btn', element: btn, type: 'button' },
      { id: 'lit', element: lit, type: 'generic' },
    ]);
    const metric = customPropertyConsistency(batch.elements, VIEWPORT);
    // btn: a derived background; its colour is inherited unchanged (no choice).
    // lit: a literal background (hardcoded) and a colour equal to --brand (half).
    expect(metric.rawData).toMatchObject({
      elementsUsingTokens: 1,
      totalColorProps: 3,
      tokenDerivedColors: 1,
      valueMatchedColors: 1,
      hardcodedColors: 1,
      tokenAttribution: true,
    });
  });

  it('customPropertyConsistency: an unpainted (transparent) background is not a hardcoded colour', () => {
    sheet(':root { --brand: rgb(31, 78, 140); }');
    const els = [add('div', 'a'), add('div', 'b')];
    for (const el of els) el.style.setProperty('color', 'var(--brand)');
    const batch = collectDesignBatch(els.map((element, i) => ({ id: `e${i}`, element })));
    expect(batch.elements.map((e) => e.styles.backgroundColor)).toEqual([
      'rgba(0, 0, 0, 0)',
      'rgba(0, 0, 0, 0)',
    ]);
    const metric = customPropertyConsistency(batch.elements, VIEWPORT);
    expect(metric.rawData).toMatchObject({
      totalColorProps: 2,
      tokenDerivedColors: 2,
      hardcodedColors: 0,
    });
  });
});
