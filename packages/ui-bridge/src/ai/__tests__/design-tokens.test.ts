/**
 * Design tokens as a page uses them (`ai/design-tokens.ts`): root tokens and
 * scopes reported once per batch, per-property attribution (`derived`,
 * `overridden`, `matches`, `inherited`), and `customPropertyConsistency`
 * reading that attribution.
 *
 * jsdom's CSSOM leaves a shorthand's longhands empty when it is written with
 * `var()`, as browsers do, but its computed style substitutes no `var()` and
 * drops a `var()` shorthand, and it does not convert units or keywords
 * (`1em`, `bold`, `calc()`). Where a test needs the value a browser computes,
 * for an element or for the token probe, it states it (`browserComputes`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureResponsiveSnapshots,
  getCSSCustomProperties,
  getElementDesignData,
  indexCustomProperties,
} from '../design-inspector';
import {
  MAX_INHERITANCE_DEPTH,
  MAX_SCOPE_OVERRIDES,
  MAX_TOKEN_VALUE_LENGTH,
  normalizedForms,
  referencesOf,
  reportedTokensOf,
  isUniversalSelector,
  scrubScriptValue,
  varNames,
} from '../design-tokens';
import { normalizeColor } from '../css-color';
import { emptyCoverage, resolveNestedSelector, styleRules } from '../stylesheet-walk';
import { collectDesignBatch } from '../../specs/quality-request';
import { designAuditOf, elementStylesOf } from '../../specs/design-request';
import type { StyleGuideConfig } from '../../specs/style-types';
import { customPropertyConsistency } from '../../specs/quality-metrics';
import { REDACTED_VALUE } from '../../core/redaction';
import type { ElementDesignData } from '../../core/types';

/** Whether `el` is the token probe (`ai/token-probe.ts`). */
function isProbe(el: Element): boolean {
  const root = el.getRootNode();
  return root instanceof ShadowRoot && root.host.tagName === 'UI-BRIDGE-TOKEN-PROBE';
}

/**
 * State the computed values a browser would give these elements (kebab-case
 * properties), and, optionally, what it would compute for the token probe from
 * the probe's inline style.
 */
function browserComputes(
  values: Map<Element, Record<string, string>>,
  probe?: (inline: CSSStyleDeclaration, longhand: string, probe: HTMLElement) => string | undefined
): void {
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    const computed = real(el, pseudo);
    let stated = values.get(el as Element);
    if (!stated && probe && isProbe(el as Element)) {
      const inline = (el as HTMLElement).style;
      stated = new Proxy({} as Record<string, string>, {
        get: (_t, longhand: string) => probe(inline, longhand, el as HTMLElement),
      });
    }
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
        overrideCount: 1,
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
    // A redacted scope is named by its tag alone.
    expect(batch.scopes['scope-1'].element).toBe('div');
    expect(batch.tokens['--brand'].value).toBe('rgb(31, 78, 140)');
  });

  it('a blanket declaration that changes nothing (Tailwind preflight) makes no scope', () => {
    sheet(
      ':root { --brand: rgb(31, 78, 140); }',
      '*, ::before, ::after { --tw-ring: 0 0 #0000; --tw-shadow: 0 0 #0000; }',
      '.theme { --brand: rgb(200, 0, 0); }'
    );
    const outer = add('div', 'outer');
    const theme = add('section', 'theme', outer);
    const inner = add('div', 'inner', theme);
    const batch = collectDesignBatch([{ id: 'k', element: add('span', 'k', inner) }]);
    expect(batch.scopeCount).toBe(1);
    expect(Object.values(batch.scopes)).toEqual([
      { element: 'section.theme', overrides: { '--brand': 'rgb(200, 0, 0)' }, overrideCount: 1 },
    ]);
  });

  it('caps a scope’s overrides and the scopes’ total size, and says so', () => {
    const long = 'x'.repeat(300);
    const many = Array.from({ length: MAX_SCOPE_OVERRIDES + 1 }, (_, i) => `--t${i}: ${long}${i};`);
    sheet(`.big { ${many.join(' ')} }`);
    const kids = [add('div', 'big'), add('div', 'big')].map((wrapper, i) => ({
      id: `k${i}`,
      element: add('span', 'k', wrapper),
    }));
    const batch = collectDesignBatch(kids);
    const scopes = Object.values(batch.scopes);
    expect(batch.scopeCount).toBe(2);
    // The second scope would pass the byte budget.
    expect(scopes).toHaveLength(1);
    expect(batch.scopeBudgetExceeded).toBe(true);
    expect(scopes[0].overrideCount).toBe(MAX_SCOPE_OVERRIDES + 1);
    expect(Object.keys(scopes[0].overrides)).toHaveLength(MAX_SCOPE_OVERRIDES);
    expect(batch.truncatedValues).toBe(MAX_SCOPE_OVERRIDES);
  });

  it('keeps an inline value only when it is a colour, a dimension or a short number', () => {
    expect(scrubScriptValue('#ff0000')).toBe('#ff0000');
    expect(scrubScriptValue('12px')).toBe('12px');
    expect(scrubScriptValue('1000')).toBe('1000');
    expect(scrubScriptValue('0.5')).toBe('0.5');
    expect(scrubScriptValue('5551234567')).toBe(REDACTED_VALUE);
    expect(scrubScriptValue('Alice')).toBe(REDACTED_VALUE);
    expect(scrubScriptValue('url("https://cdn.test/a.png")')).toBe(REDACTED_VALUE);
  });

  // ------------------------------------------------------- declarations

  it('expands a box shorthand per side: each side gets only its own token', () => {
    sheet('.p { padding: var(--s2) var(--s4); margin: var(--m1) var(--m2) var(--m3) var(--m4); }');
    const refs = referencesOf((style.sheet!.cssRules[0] as CSSStyleRule).style)!;
    const names = (p: string) => refs.get(p as never)?.[0].names;
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
    expect(refs.get('paddingLeft')).toEqual([
      {
        names: ['--spacing'],
        source: 'padding-inline',
        text: 'calc(var(--spacing) * 4)',
        compare: ['padding-left'],
        expression: true,
        ambiguous: false,
      },
    ]);
    expect(refs.get('paddingRight')?.[0].compare).toEqual(['padding-right']);
    expect(refs.get('paddingTop')).toBeUndefined();
    expect(refs.get('marginTop')?.[0]).toMatchObject({ names: ['--mb'], compare: ['margin-top'] });
    // A longhand is compared on its own computed longhand, not the whole shorthand.
    expect(refs.get('borderRadius')?.[0]).toMatchObject({
      names: ['--r'],
      compare: ['border-top-left-radius'],
    });
    expect(refs.get('gap')?.[0]).toMatchObject({ names: ['--g'], compare: ['row-gap'] });
    expect(refs.get('border')?.[0]).toMatchObject({
      names: ['--bc'],
      compare: ['border-top-color'],
    });
    expect(refs.get('color')?.[0]).toMatchObject({ names: ['--c'], expression: false });
  });

  it('Tailwind-style calc() spacing is derived as an expression on both inline sides', () => {
    sheet(':root { --spacing: 0.25rem; }', '.tw { padding-inline: calc(var(--spacing) * 4); }');
    const el = add('div', 'tw');
    browserComputes(
      new Map([[el, { 'padding-left': '16px', 'padding-right': '16px' }]]),
      // calc(0.25rem * 4) at a 16px root.
      (inline, longhand) =>
        inline.getPropertyValue('padding-inline') === 'calc(0.25rem * 4)' &&
        (longhand === 'padding-left' || longhand === 'padding-right')
          ? '16px'
          : undefined
    );
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

  it('a multi-var() font shorthand is attributed per longhand to the token that produced it', () => {
    sheet(':root { --w: 700; --s: 16px; --f: Inter; }', '.f { font: var(--w) var(--s) var(--f); }');
    const el = add('p', 'f');
    browserComputes(new Map([[el, { 'font-size': '16px', 'font-weight': '700' }]]));
    const { tokenMatches } = read(el);
    expect(tokenMatches?.fontSize).toEqual({ derived: ['--s'], expression: true });
    expect(tokenMatches?.fontWeight).toEqual({ derived: ['--w'], expression: true });
  });

  it('a font shorthand token is not attributed to a longhand it did not produce', () => {
    sheet(':root { --font-body: 700 16px Inter; }', '.f { font: var(--font-body); }');
    const el = add('p', 'f');
    // A later rule set the size: the shorthand did not produce 20px.
    browserComputes(new Map([[el, { 'font-size': '20px', 'font-weight': '700' }]]));
    const { tokenMatches } = read(el);
    expect(tokenMatches?.fontSize).toBeUndefined();
    expect(tokenMatches?.fontWeight).toEqual({ derived: ['--font-body'] });
  });

  it('a var() background shorthand is derived when the browser computed its value', () => {
    sheet(':root { --brand: rgb(31, 78, 140); }', '.btn { background: var(--brand); }');
    const btn = add('button', 'btn');
    browserComputes(new Map([[btn, { 'background-color': 'rgb(31, 78, 140)' }]]));
    expect(read(btn).tokenMatches?.backgroundColor).toEqual({ derived: ['--brand'] });
  });

  // ------------------------------------------------------ cascade checks

  it('without a stated computed value, an unsubstituted var() is not taken as derived', () => {
    // jsdom leaves var() in computed values; a browser never does. With the
    // test-only shortcut off (the default), only the candidate comparison
    // decides, so a wrong candidate cannot pass as derived.
    sheet(':root { --brand: rgb(31, 78, 140); }', '.x { color: var(--brand); }');
    const el = add('span', 'x');
    expect(read(el).tokenMatches?.color).toEqual({ unverified: ['--brand'] });
  });

  it('removes its probe on the exception path and after a single-element read', () => {
    sheet(':root { --pad: 1em; }', '.e { padding-left: var(--pad); }');
    const first = add('div', 'e');
    const broken = add('div', 'e');
    broken.getBoundingClientRect = () => {
      throw new Error('layout read failed');
    };
    browserComputes(new Map([[first, { 'padding-left': '16px' }]]));
    document.querySelectorAll('ui-bridge-token-probe').forEach((p) => p.remove());
    expect(() =>
      collectDesignBatch([
        { id: 'first', element: first },
        { id: 'broken', element: broken },
      ])
    ).toThrow('layout read failed');
    expect(document.querySelector('ui-bridge-token-probe')).toBeNull();

    elementStylesOf('first', { id: 'first', element: first });
    expect(document.querySelector('ui-bridge-token-probe')).toBeNull();
  });

  it('mutates the light DOM only by one insert (after <body>) and one remove per batch', () => {
    sheet(
      ':root { --pad: 1em; --brand: rgb(31, 78, 140); }',
      '.e { padding-left: var(--pad); color: var(--brand); }'
    );
    const els = [add('div', 'e'), add('div', 'e')];
    browserComputes(
      new Map(
        els.map(
          (el) =>
            [el, { 'padding-left': '16px', color: 'rgb(31, 78, 140)' }] as [
              Element,
              Record<string, string>,
            ]
        )
      )
    );
    document.querySelectorAll('ui-bridge-token-probe').forEach((p) => p.remove());
    const observer = new MutationObserver(() => undefined);
    observer.observe(document, { subtree: true, childList: true, attributes: true });
    collectDesignBatch(els.map((element, i) => ({ id: `e${i}`, element })));
    const records = observer.takeRecords();
    observer.disconnect();
    expect(records.map((r) => r.type)).toEqual(['childList', 'childList']);
    expect(records[0].addedNodes[0].nodeName).toBe('UI-BRIDGE-TOKEN-PROBE');
    expect(records[0].previousSibling).toBe(document.body);
    expect(records[0].nextSibling).toBeNull();
    expect(records[1].removedNodes[0].nodeName).toBe('UI-BRIDGE-TOKEN-PROBE');
  });

  it('removes its probe from the document when the batch is read', () => {
    sheet(':root { --pad: 1em; }', '.e { padding-left: var(--pad); }');
    const el = add('div', 'e');
    // A resolved value, so the token is compared through the probe.
    browserComputes(new Map([[el, { 'padding-left': '16px' }]]));
    // Probes of earlier direct reads (no batch to dispose them) leave on the next task.
    document.querySelectorAll('ui-bridge-token-probe').forEach((p) => p.remove());
    collectDesignBatch([{ id: 'e', element: el }]);
    expect(document.querySelector('ui-bridge-token-probe')).toBeNull();
  });

  it('a bare 0 token is derived on a 0px side (resolved, not compared as text)', () => {
    sheet(
      ':root { --space-0: 0; --space-4: 16px; }',
      '.h { margin: var(--space-0) var(--space-4); }'
    );
    const el = add('h1', 'h');
    browserComputes(
      new Map([
        [
          el,
          {
            'margin-top': '0px',
            'margin-right': '16px',
            'margin-bottom': '0px',
            'margin-left': '16px',
          },
        ],
      ])
    );
    const { tokenMatches } = read(el);
    expect(tokenMatches?.marginTop).toEqual({ derived: ['--space-0'] });
    expect(tokenMatches?.marginLeft).toEqual({ derived: ['--space-4'] });
  });

  it('a keyword token (bold) is derived when the browser computes it to the element’s value', () => {
    sheet(':root { --weight-strong: bold; }', '.b { font-weight: var(--weight-strong); }');
    const el = add('b', 'b');
    browserComputes(new Map([[el, { 'font-weight': '700' }]]), (inline, longhand) =>
      longhand === 'font-weight' && inline.getPropertyValue('font-weight') === 'bold'
        ? '700'
        : undefined
    );
    expect(read(el).tokenMatches?.fontWeight).toEqual({ derived: ['--weight-strong'] });
  });

  it('a value the probe cannot compare (1em against px) is unverified, never overridden', () => {
    sheet(':root { --pad: 1em; }', '.e { padding-left: var(--pad); }');
    const el = add('div', 'e');
    browserComputes(new Map([[el, { 'padding-left': '16px' }]]), (inline, longhand) =>
      longhand === 'padding-left' ? inline.getPropertyValue('padding-left') : undefined
    );
    expect(read(el).tokenMatches?.paddingLeft).toEqual({ unverified: ['--pad'] });
  });

  it('in a browser, a token that does not resolve on the element does not fall back to the root', () => {
    sheet(':root { --brand: rgb(31, 78, 140); }', '.r { color: var(--brand); }');
    const el = add('span', 'r');
    // A browser inherits custom properties (shown on <head>); here the token
    // was reset (`--brand: initial`) on the element, so it resolves to nothing.
    browserComputes(
      new Map<Element, Record<string, string>>([
        [document.head, { '--brand': 'rgb(31, 78, 140)' }],
        [el, { '--brand': '', color: 'rgb(31, 78, 140)' }],
      ])
    );
    expect(read(el).tokenMatches?.color).toEqual({ unverified: ['--brand'] });
  });

  it('of several declarations, the one that computes to the value is derived', () => {
    sheet(
      ':root { --a: rgb(1, 1, 1); --b: rgb(2, 2, 2); }',
      // The more specific rule comes first in source order and wins.
      '.btn.x { color: var(--a); }',
      '.btn { color: var(--b); }'
    );
    const btn = add('button', 'btn x');
    browserComputes(new Map([[btn, { color: 'rgb(1, 1, 1)' }]]));
    expect(read(btn).tokenMatches?.color).toEqual({ derived: ['--a'] });
  });

  it('a unitless line-height inherits as a factor: derived through a font-size change', () => {
    sheet(
      ':root { --line-height-normal: 1.5; }',
      '.wrap { line-height: var(--line-height-normal); }'
    );
    const wrap = add('div', 'wrap');
    const small = add('span', 'small', wrap);
    browserComputes(
      new Map<Element, Record<string, string>>([
        [wrap, { 'font-size': '16px', 'line-height': '24px' }],
        [small, { 'font-size': '14px', 'line-height': '21px' }],
      ]),
      // A browser computes `line-height: 1.5` at 16px to 24px.
      (inline, longhand) =>
        longhand === 'line-height' && inline.getPropertyValue('line-height') === '1.5'
          ? `${1.5 * parseFloat(inline.getPropertyValue('font-size'))}px`
          : undefined
    );
    expect(read(small, [small]).tokenMatches?.lineHeight).toEqual({
      derived: ['--line-height-normal'],
      via: 'inherited',
    });
  });

  it('the audit reads no stylesheets unless its guide constrains a custom property', () => {
    sheet(':root { --brand: red; }', '.b { color: var(--brand); }');
    const el = add('button', 'b');
    const guide = (property: string): StyleGuideConfig =>
      ({
        version: '1',
        name: 'g',
        tokens: {},
        rules: [
          {
            id: 'r',
            elementType: 'button',
            constraints: [{ type: 'exact', property, value: 'x' }],
          },
        ],
      }) as unknown as StyleGuideConfig;
    const sheets = vi.spyOn(document, 'styleSheets', 'get');
    designAuditOf([{ id: 'b', element: el, type: 'button' }], { guide: guide('color') }, null);
    // No token attribution, no custom properties: the page is not walked or probed.
    expect(sheets).not.toHaveBeenCalled();
    designAuditOf([{ id: 'b', element: el, type: 'button' }], { guide: guide('--brand') }, null);
    expect(sheets).toHaveBeenCalled();
  });

  it('the heuristic audit lists at most maxResults issues and reports the cut', () => {
    const buttons = [add('button', 'x'), add('button', 'y'), add('button', 'z')];
    const report = designAuditOf(
      buttons.map((element, i) => ({ id: `b${i}`, element, type: 'button' })),
      { maxResults: 2 },
      null
    );
    if (report.mode !== 'heuristic') throw new Error('expected heuristic mode');
    // jsdom lays out nothing: every button is under the 44px touch target.
    expect(report.issues).toHaveLength(2);
    expect(report).toMatchObject({ maxResults: 2, listableResults: 3, resultsTruncated: true });
  });

  it('says where an inherited colour without a token came from: literal, initial or unknown', () => {
    sheet(
      ':root { --brand: rgb(31, 78, 140); --nope: rgb(1, 1, 1); }',
      '.lit-parent { color: rgb(9, 9, 9); }',
      '.var-parent { color: var(--nope); }'
    );
    const litParent = add('div', 'lit-parent');
    const litChild = add('span', 'c', litParent);
    const varParent = add('div', 'var-parent');
    const varChild = add('span', 'c', varParent);
    const nine = { color: 'rgb(9, 9, 9)' };
    browserComputes(
      new Map<Element, Record<string, string>>([
        [litParent, nine],
        [litChild, nine],
        // The var() lost to something else: its colour is not --nope's.
        [varParent, nine],
        [varChild, nine],
      ])
    );
    const index = indexCustomProperties(document, [litChild, varChild]);
    const color = (el: HTMLElement) =>
      getElementDesignData(el, { customProperties: index }).tokenMatches?.color;
    expect(color(litChild)).toEqual({ inherited: true, inheritedFrom: 'literal' });
    expect(color(varChild)).toEqual({ inherited: true, inheritedFrom: 'unknown' });
  });

  it('an element that declares the colour itself is not inheriting it, even when equal', () => {
    sheet('.p { color: rgb(9, 9, 9); }', '.c { color: rgb(9, 9, 9); }');
    const parent = add('div', 'p');
    const child = add('span', 'c', parent);
    const nine = { color: 'rgb(9, 9, 9)' };
    browserComputes(
      new Map<Element, Record<string, string>>([
        [parent, nine],
        [child, nine],
      ])
    );
    // A choice made on the element (hardcoded), not an inherited value.
    expect(read(child, [child]).tokenMatches?.color).toBeUndefined();
  });

  it('customPropertyConsistency: a page that never declares a colour is not scored as hardcoded', () => {
    sheet(':root { --space: 4px; }', '.p { padding-left: var(--space); }');
    const kids = [add('p', 'p'), add('p', 'p')];
    const black = { color: 'rgb(0, 0, 0)', 'padding-left': '4px' };
    browserComputes(
      new Map<Element, Record<string, string>>([
        [host, { color: 'rgb(0, 0, 0)' }],
        [kids[0], black],
        [kids[1], black],
      ])
    );
    const batch = collectDesignBatch(kids.map((element, i) => ({ id: `k${i}`, element })));
    const metric = customPropertyConsistency(batch.elements, VIEWPORT);
    expect(metric.rawData).toMatchObject({
      inheritedInitialColors: 2,
      inheritedHardcodedColors: 0,
      colorWeight: 0,
      avoidanceScore: 100,
    });
  });

  it('customPropertyConsistency: an inherited colour from an unconfirmed var() earns half', () => {
    sheet(':root { --nope: rgb(1, 1, 1); }', '.wrap { color: var(--nope); }');
    const wrap = add('div', 'wrap');
    const kid = add('p', 'k', wrap);
    const nine = { color: 'rgb(9, 9, 9)' };
    browserComputes(
      new Map<Element, Record<string, string>>([
        [wrap, nine],
        [kid, nine],
      ])
    );
    const batch = collectDesignBatch([{ id: 'k', element: kid }]);
    const metric = customPropertyConsistency(batch.elements, VIEWPORT);
    expect(metric.rawData).toMatchObject({ inheritedUnknownColors: 1, colorWeight: 0.5 });
    expect((metric.rawData as { avoidanceScore: number }).avoidanceScore).toBe(50);
  });

  it('follows a two-hop chain to a script value on a grandparent', () => {
    sheet(':root { --a: var(--b); }', '.x { --b: var(--user); }', '.y { --c: var(--a); }');
    const grandparent = add('div', 'gp');
    grandparent.style.setProperty('--user', 'Alice');
    const parent = add('div', 'p', grandparent);
    const el = add('div', 'x y', parent);
    const props = getCSSCustomProperties(el, indexCustomProperties(document, [el]));
    // --c -> --a -> --b -> --user (set from script two levels up).
    expect(props['--c']).toBe(REDACTED_VALUE);
    expect(props['--b']).toBe(REDACTED_VALUE);
  });

  it('a var() reference cycle terminates', { timeout: 1_000 }, () => {
    sheet('.cyc { --p: var(--q); --q: var(--p); }');
    const el = add('div', 'cyc');
    el.style.setProperty('--other', '1px');
    const props = getCSSCustomProperties(el, indexCustomProperties(document, [el]));
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['--p', '--q']));
    expect(props['--p']).not.toBe(REDACTED_VALUE);
  });

  it('follows a chain through rules the element does not match, outside the index', () => {
    sheet('.a { --x: var(--user); }', '.b { --y: var(--x); }');
    // Detached: read without a batch index, by the per-element walk.
    const el = document.createElement('div');
    el.className = 'b';
    el.style.setProperty('--user', 'Alice');
    expect(getCSSCustomProperties(el)['--y']).toBe(REDACTED_VALUE);
  });

  it('the probe cache keys on the parent value a declaration reads (em in font-size)', () => {
    sheet(':root { --fs: 1.6em; }', '.t { font-size: var(--fs); }');
    const small = add('div', 'small-parent');
    const big = add('div', 'big-parent');
    const a = add('span', 't', small);
    const b = add('span', 't', big);
    // Both computed 16px (b's own value is contrived to match a's): only the
    // parent differs, and 1.6em of it is what the declaration computes.
    browserComputes(
      new Map<Element, Record<string, string>>([
        [small, { 'font-size': '10px' }],
        [big, { 'font-size': '20px' }],
        [a, { 'font-size': '16px' }],
        [b, { 'font-size': '16px' }],
      ]),
      (inline, longhand, probe) => {
        if (longhand !== 'font-size' || inline.getPropertyValue('font-size') !== '1.6em') {
          return undefined;
        }
        const parentSize = parseFloat((probe.parentElement as HTMLElement).style.fontSize);
        return `${1.6 * parentSize}px`;
      }
    );
    const index = indexCustomProperties(document, [a, b]);
    const size = (el: HTMLElement) =>
      getElementDesignData(el, { customProperties: index }).tokenMatches?.fontSize;
    expect(size(a)).toEqual({ derived: ['--fs'] });
    expect(size(b)).toEqual({ overridden: ['--fs'] });
  });

  it('a ch/ex value is resolved with the element’s font', () => {
    sheet(':root { --w: 2ch; }', '.m { padding-left: var(--w); }');
    const el = add('code', 'm');
    browserComputes(
      new Map([[el, { 'font-family': 'monospace', 'padding-left': '19.2px' }]]),
      (inline, longhand) => {
        if (longhand !== 'padding-left' || inline.getPropertyValue('padding-left') !== '2ch') {
          return undefined;
        }
        // 2ch is wider in a monospace font than in the default one.
        return inline.getPropertyValue('font-family') === 'monospace' ? '19.2px' : '16px';
      }
    );
    expect(read(el).tokenMatches?.paddingLeft).toEqual({ derived: ['--w'] });
  });

  it('reads var() names case-insensitively, with non-ASCII and escaped characters', () => {
    expect(varNames('VAR(--Brand) var( --ünïcode ) var(--esc\\.aped)')).toEqual([
      '--Brand',
      '--ünïcode',
      // CSS escapes resolved: the name as the CSSOM reports it.
      '--esc.aped',
    ]);
  });

  it('a line height through calc() is not a unitless factor', () => {
    sheet(':root { --lh: 1.5; }', '.wrap { line-height: calc(var(--lh) * 1em); }');
    const wrap = add('div', 'wrap');
    const small = add('span', 'small', wrap);
    browserComputes(
      new Map<Element, Record<string, string>>([
        [wrap, { 'font-size': '16px', 'line-height': '24px' }],
        [small, { 'font-size': '14px', 'line-height': '21px' }],
      ]),
      (inline, longhand) =>
        longhand === 'line-height' && inline.getPropertyValue('line-height').startsWith('calc(')
          ? '24px'
          : undefined
    );
    // calc(1.5 * 1em) computes to a length at .wrap, which inherits as 24px,
    // not as a factor: 21px on 14px text is not derived from it.
    expect(read(small, [small]).tokenMatches?.lineHeight?.derived).toBeUndefined();
  });

  it('a script value set on an ancestor between viewports is scrubbed at the later viewport', async () => {
    sheet('.t { --title: var(--user); }');
    const card = add('div', 'card');
    const el = add('h2', 't', card);
    let frames = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      setTimeout(() => {
        frames++;
        // Between the first viewport's read and the second's.
        if (frames === 2) card.style.setProperty('--user', 'Alice');
        cb(0);
      }, 0);
      return frames;
    });
    const capture = await captureResponsiveSnapshots(
      { getAllElements: () => [{ id: 't', element: el, type: 'heading', label: 't' }] },
      [320, 768]
    );
    const title = capture.snapshots.map((snap) => snap.elements[0].customProperties?.['--title']);
    expect(title[0]).not.toBe(REDACTED_VALUE);
    expect(title[1]).toBe(REDACTED_VALUE);
  });

  it('a literal that lost the cascade does not stop an inherited token (`color: inherit`)', () => {
    sheet(
      ':root { --fg: rgb(31, 78, 140); }',
      '.nav { color: var(--fg); }',
      'a { color: #06c; }',
      '.nav a { color: inherit; }'
    );
    const nav = add('nav', 'nav');
    const link = add('a', 'link', nav);
    const fg = { color: 'rgb(31, 78, 140)' };
    browserComputes(
      new Map<Element, Record<string, string>>([
        [nav, fg],
        [link, fg],
      ])
    );
    expect(read(link, [link]).tokenMatches?.color).toEqual({
      derived: ['--fg'],
      via: 'inherited',
    });
  });

  it('a relative literal reproducing the parent (font-size: 100%) passes the inherited token through', () => {
    sheet(
      ':root { --fs: 16px; }',
      '.wrap { font-size: var(--fs); }',
      'button { font-size: 100%; }'
    );
    const wrap = add('div', 'wrap');
    const button = add('button', 'b', wrap);
    const sixteen = { 'font-size': '16px' };
    browserComputes(
      new Map<Element, Record<string, string>>([
        [wrap, sixteen],
        [button, sixteen],
      ]),
      (inline, longhand, probe) =>
        longhand === 'font-size' && inline.getPropertyValue('font-size') === '100%'
          ? (probe.parentElement as HTMLElement).style.fontSize
          : undefined
    );
    expect(read(button, [button]).tokenMatches?.fontSize).toEqual({
      derived: ['--fs'],
      via: 'inherited',
    });
  });

  it('an ancestor whose var() lost to a literal gives the inherited colour a literal origin', () => {
    sheet(
      ':root { --x: rgb(1, 1, 1); }',
      '.p { color: var(--x); }',
      '.p.lit { color: rgb(9, 9, 9); }'
    );
    const parent = add('div', 'p lit');
    const child = add('span', 'c', parent);
    const nine = { color: 'rgb(9, 9, 9)' };
    browserComputes(
      new Map<Element, Record<string, string>>([
        [parent, nine],
        [child, nine],
      ])
    );
    expect(read(child, [child]).tokenMatches?.color).toEqual({
      inherited: true,
      inheritedFrom: 'literal',
    });
  });

  it('with a sheet it could not read, an undeclared inherited colour is unknown, not initial', () => {
    sheet(':root { --x: 1px; }');
    const crossOrigin = {
      get cssRules(): CSSRuleList {
        throw new DOMException('cross-origin stylesheet', 'SecurityError');
      },
    };
    vi.spyOn(document, 'styleSheets', 'get').mockReturnValue([crossOrigin, style.sheet] as never);
    const parent = add('div', 'parent');
    const child = add('span', 'child', parent);
    const black = { color: 'rgb(0, 0, 0)' };
    browserComputes(
      new Map<Element, Record<string, string>>([
        [parent, black],
        [child, black],
      ])
    );
    expect(read(child, [child]).tokenMatches?.color).toEqual({
      inherited: true,
      inheritedFrom: 'unknown',
    });
  });

  it('the fallback var() graph sees a rule added after a first read, also inside @media', () => {
    sheet('.b { --y: var(--x); }', '@media (min-width: 1px) { .z { color: red; } }');
    const el = document.createElement('div');
    el.className = 'b';
    el.style.setProperty('--user', 'Alice');
    // No rule links --x to the script value yet.
    expect(getCSSCustomProperties(el)['--y']).not.toBe(REDACTED_VALUE);
    const media = style.sheet!.cssRules[1] as CSSMediaRule;
    media.insertRule('.a { --x: var(--user); }', 0);
    expect(getCSSCustomProperties(el)['--y']).toBe(REDACTED_VALUE);
  });

  it('the fallback var() graph includes rules whose condition does not hold now', () => {
    window.matchMedia = ((query: string) => ({ matches: !query.includes('9999px') })) as never;
    try {
      sheet('@media (min-width: 9999px) { .a { --x: var(--user); } }', '.b { --y: var(--x); }');
      const el = document.createElement('div');
      el.className = 'b';
      el.style.setProperty('--user', 'Alice');
      expect(getCSSCustomProperties(el)['--y']).toBe(REDACTED_VALUE);
    } finally {
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });

  it('a px line-height inherited with the same ratio is not taken as a unitless factor', () => {
    sheet(':root { --lh: 24px; }', '.wrap { line-height: var(--lh); }');
    const wrap = add('div', 'wrap');
    const title = add('h2', 'title', wrap);
    browserComputes(
      new Map<Element, Record<string, string>>([
        [wrap, { 'font-size': '16px', 'line-height': '24px' }],
        // A hardcoded 30px on 20px text: the same 1.5 ratio, but not inherited.
        [title, { 'font-size': '20px', 'line-height': '30px' }],
      ])
    );
    const tokenMatches = read(title, [title]).tokenMatches;
    expect(tokenMatches?.lineHeight?.derived).toBeUndefined();
    expect(tokenMatches?.lineHeight?.inherited).toBeUndefined();
  });

  it('an other-kind value the probe may lack context for (a shadow) is unverified, not overridden', () => {
    sheet(':root { --shadow: 0 1px 2px; }', '.s { box-shadow: var(--shadow); }');
    const el = add('div', 's');
    browserComputes(new Map([[el, { 'box-shadow': 'rgb(9, 9, 9) 0px 1px 2px 0px' }]]));
    expect(read(el).tokenMatches?.boxShadow).toEqual({ unverified: ['--shadow'] });
  });

  it('carries the element’s colour into the probe: an implicit currentcolor shadow is derived', () => {
    sheet(':root { --shadow: 0 1px 2px; }', '.s { box-shadow: var(--shadow); }');
    const el = add('div', 's');
    browserComputes(
      new Map([[el, { color: 'rgb(9, 9, 9)', 'box-shadow': 'rgb(9, 9, 9) 0px 1px 2px 0px' }]]),
      // A browser serialises a colourless shadow with the element's colour.
      (inline, longhand) =>
        longhand === 'box-shadow' && inline.getPropertyValue('box-shadow') === '0 1px 2px'
          ? `${inline.getPropertyValue('color')} 0px 1px 2px 0px`.trim()
          : undefined
    );
    expect(read(el).tokenMatches?.boxShadow).toEqual({ derived: ['--shadow'] });
  });

  it('without shadow DOM there is no probe: the comparison is unverified and the page untouched', () => {
    sheet(':root { --pad: 1em; }', '.e { padding-left: var(--pad); }');
    const el = add('div', 'e');
    browserComputes(new Map([[el, { 'padding-left': '16px' }]]));
    document.querySelectorAll('ui-bridge-token-probe').forEach((p) => p.remove());
    const proto = Element.prototype as unknown as { attachShadow?: unknown };
    const original = proto.attachShadow;
    proto.attachShadow = undefined;
    const observer = new MutationObserver(() => undefined);
    observer.observe(document, { subtree: true, childList: true, attributes: true });
    try {
      expect(read(el).tokenMatches?.paddingLeft).toEqual({ unverified: ['--pad'] });
      expect(observer.takeRecords()).toEqual([]);
    } finally {
      observer.disconnect();
      proto.attachShadow = original;
    }
  });

  it('every declaration computing to the value is reported, the later rule first', () => {
    sheet(
      ':root { --a: rgb(1, 1, 1); --b: rgb(1, 1, 1); }',
      '.btn { color: var(--a); }',
      '.btn { color: var(--b); }'
    );
    const btn = add('button', 'btn');
    browserComputes(new Map([[btn, { color: 'rgb(1, 1, 1)' }]]));
    expect(read(btn).tokenMatches?.color).toEqual({ derived: ['--b', '--a'] });
  });

  it('a computed value of the same kind that differs is overridden, even a keyword', () => {
    sheet(':root { --font-ui: Inter; }', '.f { font-family: var(--font-ui); }');
    const el = add('p', 'f');
    browserComputes(new Map([[el, { 'font-family': 'Georgia' }]]));
    expect(read(el).tokenMatches?.fontFamily).toEqual({ overridden: ['--font-ui'] });
  });

  it('a width token is probed with a visible border style, so it does not compute to 0', () => {
    sheet(':root { --bw: 2px; }', '.b { border-top-width: var(--bw); }');
    const el = add('div', 'b');
    browserComputes(new Map([[el, { 'border-top-width': '2px' }]]), (inline, longhand) => {
      if (longhand !== 'border-top-width') return undefined;
      // A browser computes a border width to 0 while its style is none.
      const styled =
        inline.getPropertyValue('border-top-style') === 'solid' ||
        inline.getPropertyValue('border-style') === 'solid';
      return styled ? inline.getPropertyValue('border-top-width') : '0px';
    });
    expect(read(el).tokenMatches?.border).toEqual({ derived: ['--bw'] });
  });

  it('a container-unit token is unverified: the probe has no container', () => {
    sheet(':root { --w: clamp(1px, 10cqi, 99px); }', '.c { padding-left: var(--w); }');
    const el = add('div', 'c');
    // A browser resolves cq units without a container against the small
    // viewport, so the probe would compute some px value unrelated to the
    // element's container.
    browserComputes(new Map([[el, { 'padding-left': '40px' }]]), (inline, longhand) =>
      longhand === 'padding-left' && inline.getPropertyValue('padding-left').includes('cqi')
        ? '128px'
        : undefined
    );
    expect(read(el).tokenMatches?.paddingLeft).toEqual({ unverified: ['--w'] });
  });

  it('probes only the colour layer of a background shorthand, never its images', () => {
    sheet(
      ':root { --brand: rgb(31, 78, 140); }',
      '.bg { background: url(hero.png) no-repeat var(--brand); }'
    );
    const el = add('div', 'bg');
    const probed: string[] = [];
    browserComputes(new Map([[el, { 'background-color': 'rgb(31, 78, 140)' }]]), (inline) => {
      probed.push(inline.getPropertyValue('background'));
      return undefined;
    });
    expect(read(el).tokenMatches?.backgroundColor).toEqual({
      derived: ['--brand'],
      expression: true,
    });
    expect(probed.length).toBeGreaterThan(0);
    expect(probed.some((v) => v.includes('url('))).toBe(false);
  });

  it('a descendant re-declaring a token to the value it already has makes no scope', () => {
    sheet(':root { --brand: rgb(31, 78, 140); }', '.theme, .theme * { --brand: rgb(200, 0, 0); }');
    const theme = add('div', 'theme');
    const inner = add('div', 'inner', theme);
    const batch = collectDesignBatch([{ id: 'k', element: add('span', 'k', inner) }]);
    // Only .theme changes the value; .inner (and the leaf) re-declare it unchanged.
    expect(batch.scopeCount).toBe(1);
    expect(Object.values(batch.scopes).map((scope) => scope.element)).toEqual(['div.theme']);
  });

  it('a variable every element resets (Tailwind utilities + preflight) makes no scope', () => {
    sheet(
      '*, ::before, ::after { --tw-shadow: 0 0 #0000; }',
      '.shadow-md { --tw-shadow: 0 4px 6px rgb(0, 0, 0); }'
    );
    const card = add('div', 'shadow-md');
    const kids = [add('p', 'a', card), add('p', 'b', card)];
    const batch = collectDesignBatch(kids.map((element, i) => ({ id: `k${i}`, element })));
    expect(batch.scopeCount).toBe(0);
    expect(batch.elements.every((e) => e.tokenScopes === undefined)).toBe(true);
  });

  it('treats only page-wide universal selectors as universal', () => {
    for (const selector of [
      '*',
      '*, ::before, ::after',
      '*, ::placeholder',
      '*, ::backdrop',
      ':where(*)',
      ':is(*)',
      'html *',
      ':root *',
      ':root :where(*)',
    ]) {
      expect(isUniversalSelector(selector), selector).toBe(true);
    }
    for (const selector of [
      // Pseudo-elements alone: no element is reset.
      '::backdrop',
      '::before',
      '::before, ::after',
      '*::before',
      // Part of the page only.
      '.card > *',
      '* + *',
      '.stack > * + *',
      '*:not(.x)',
      '*:not(:is(.a, .b))',
      ':where(*):not(:is(.x))',
      'body *',
      'body > *',
      ':root > *',
      '.btn',
      '* .btn',
      '*.a',
      '*, .btn',
    ]) {
      expect(isUniversalSelector(selector), selector).toBe(false);
    }
  });

  it('a rule value built from a script-set inline property is scrubbed like one', () => {
    sheet(
      ':root { --blue: #00f; --primary: var(--blue); --bg: var(--avatar); }',
      '.card { --title: var(--user-name); }'
    );
    const root = document.documentElement;
    root.style.setProperty('--avatar', 'url("https://cdn.test/u/42.png?token=s3cr3t")');
    const card = add('div', 'card');
    card.style.setProperty('--user-name', 'Alice');
    const leaf = add('span', 'leaf', card);
    // On the element itself, with and without a batch index.
    expect(getCSSCustomProperties(card)['--title']).toBe(REDACTED_VALUE);
    expect(getCSSCustomProperties(card, indexCustomProperties(document, [card]))['--title']).toBe(
      REDACTED_VALUE
    );
    const batch = collectDesignBatch([{ id: 'leaf', element: leaf }]);
    // In the scope it makes for its subtree.
    expect(Object.values(batch.scopes)[0].overrides).toMatchObject({
      '--title': REDACTED_VALUE,
      '--user-name': REDACTED_VALUE,
    });
    // And among the root tokens: `--bg` is the script value; `--primary` is not.
    expect(batch.tokens['--bg'].value).toBe(REDACTED_VALUE);
    expect(batch.tokens['--primary'].value).not.toBe(REDACTED_VALUE);
  });

  it('a rule-declared name does not re-read an inline value raw (the inline whitelist holds)', () => {
    sheet('.avatar { --avatar-url: none; }');
    const el = add('div', 'avatar');
    el.style.setProperty('--avatar-url', 'url("https://cdn.test/u/42.png?token=s3cr3t")');
    expect(getCSSCustomProperties(el)['--avatar-url']).toBe(REDACTED_VALUE);
    const index = indexCustomProperties(document, [el, host]);
    expect(getCSSCustomProperties(el, index)['--avatar-url']).toBe(REDACTED_VALUE);
  });

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

  it('an ancestor’s INLINE var() declaration is followed too', () => {
    sheet(':root { --brand: rgb(31, 78, 140); }');
    const card = add('section', 'card');
    card.style.setProperty('color', 'var(--brand)');
    const text = add('span', 'text', card);
    const brand = { color: 'rgb(31, 78, 140)' };
    browserComputes(
      new Map<Element, Record<string, string>>([
        [card, brand],
        [text, brand],
      ])
    );
    expect(read(text, [text]).tokenMatches?.color).toEqual({
      derived: ['--brand'],
      via: 'inherited',
    });
  });

  it('a walk cut short by the depth cap is not cached as "no derivation"', () => {
    sheet(':root { --brand: rgb(31, 78, 140); }', '.top { color: var(--brand); }');
    const brand = { color: 'rgb(31, 78, 140)' };
    const chain: HTMLElement[] = [add('div', 'top')];
    for (let i = 0; i < MAX_INHERITANCE_DEPTH + 8; i++) chain.push(add('div', `d${i}`, chain[i]));
    browserComputes(new Map(chain.map((el) => [el, brand] as [Element, Record<string, string>])));
    const leaf = chain[chain.length - 1];
    // Its parent lies on the leaf's capped walk, which must not be cached.
    const near = chain[10];
    const index = indexCustomProperties(document, [leaf, near]);
    const at = (el: HTMLElement) =>
      getElementDesignData(el, { customProperties: index }).tokenMatches?.color;
    // The leaf is too deep to reach `.top`; an element near it still is.
    // Cut short at the cap: the origin is unknown, not "no token".
    expect(at(leaf)).toEqual({ inherited: true, inheritedFrom: 'unknown' });
    expect(at(near)).toEqual({ derived: ['--brand'], via: 'inherited' });
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
    // No author rule declares a colour anywhere above: the user-agent default.
    expect(read(child, [child]).tokenMatches?.color).toEqual({
      inherited: true,
      inheritedFrom: 'initial',
    });
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
    expect(normalizeColor('hsl(0.5turn 100% 50%)')).toBe(normalizeColor('hsl(180deg 100% 50%)'));
    expect(normalizeColor('hsl(3.14159rad 100% 50%)')).toBe('rgb(0, 255, 255)');
    expect(normalizeColor('hsl(200grad 100% 50%)')).toBe('rgb(0, 255, 255)');
    expect(normalizeColor('hsl(1foo 100% 50%)')).toBeNull();
    expect(normalizeColor('rebeccapurple')).toBe('rgb(102, 51, 153)');
    expect(normalizeColor('oklch(0.5 0.1 200)')).toBeNull();
    expect(normalizedForms('0', { rootFontPx: 16 })).toContain('0px');
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

  it('walks @import, adopted sheets, nested rules and nested declarations; skips unapplied sheets', () => {
    window.matchMedia = ((query: string) => ({ matches: query !== 'print' })) as never;
    const decl = (text: string) => {
      const el = document.createElement('div');
      el.setAttribute('style', text);
      return el.style;
    };
    const styleRule = (selector: string, text: string, children: object[] = []) =>
      Object.defineProperties(Object.create(CSSStyleRule.prototype), {
        selectorText: { value: selector },
        style: { value: decl(text) },
        cssRules: { value: children },
      });
    const nested = { style: decl('color: var(--after)') };
    const imported = {
      cssText: '@import url(theme.css);',
      media: { mediaText: '' },
      styleSheet: { cssRules: [styleRule('.from-import', 'color: var(--i)')] },
    };
    const card = styleRule('.card', 'color: var(--c)', [
      styleRule('& .title', 'color: var(--t)'),
      nested,
    ]);
    const sheets = [
      { cssRules: [imported, card] },
      { disabled: true, cssRules: [styleRule('.disabled', 'color: red')] },
      { media: { mediaText: 'print' }, cssRules: [styleRule('.print', 'color: red')] },
    ];
    vi.spyOn(document, 'styleSheets', 'get').mockReturnValue(sheets as never);
    Object.defineProperty(document, 'adoptedStyleSheets', {
      configurable: true,
      value: [{ cssRules: [styleRule('.adopted', 'color: var(--a)')] }],
    });
    try {
      const coverage = emptyCoverage();
      const walked = [...styleRules(document, { descend: true, coverage })].map((r) => r.selector);
      expect(walked).toEqual([
        '.from-import',
        '.card',
        ':is(.card) .title',
        // Nested declarations apply with the parent's selector.
        '.card',
        '.adopted',
      ]);
      expect(coverage.sheetsSkipped).toEqual({ disabled: 1, mediaNotMatching: 1 });
      expect(coverage.sheetsRead).toBe(3);
    } finally {
      delete (document as { adoptedStyleSheets?: unknown }).adoptedStyleSheets;
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
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
    expect(index.tokens.references.get(el)?.get('color')?.[0].names).toEqual(['--brand']);
  });

  // ------------------------------------------------------------- metric

  it('customPropertyConsistency counts derived as token use, matches-only as half, literals as hardcoded', () => {
    sheet(
      ':root { --brand: rgb(31, 78, 140); }',
      '.btn { background-color: var(--brand); }',
      '.lit { background-color: rgb(1, 2, 3); color: rgb(31, 78, 140); }'
    );
    // The container chooses a literal colour, which the button inherits.
    host.style.setProperty('color', 'rgb(0, 0, 0)');
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
    // btn: a derived background; its colour is inherited from a literal
    // (hardcoded, half weight). lit: a literal background (hardcoded) and a
    // colour equal to --brand (half credit).
    expect(metric.rawData).toMatchObject({
      elementsUsingTokens: 1,
      totalColorProps: 3,
      tokenDerivedColors: 1,
      valueMatchedColors: 1,
      hardcodedColors: 1,
      inheritedHardcodedColors: 1,
      colorWeight: 3.5,
      tokenAttribution: true,
    });
    // avoidance = (1 + 0.5) / (3 + 0.5); the score is the weighted sum.
    const avoidance = (1.5 / 3.5) * 100;
    expect(metric.rawData).toMatchObject({
      weights: { adoption: 0.5, consistency: 0.3, avoidance: 0.2 },
      adoptionScore: 50,
      consistencyScore: 100,
      avoidanceScore: Math.round(avoidance * 10) / 10,
    });
    expect(metric.score).toBe(Math.round(50 * 0.5 + 100 * 0.3 + avoidance * 0.2));
  });

  it('customPropertyConsistency: a colour inherited from a token is token-backed, adoption at half weight', () => {
    sheet(':root { --fg: rgb(31, 78, 140); }', '.wrap { color: var(--fg); }');
    const wrap = add('div', 'wrap');
    const kids = [add('p', 'a', wrap), add('p', 'b', wrap)];
    const fg = { color: 'rgb(31, 78, 140)' };
    browserComputes(
      new Map<Element, Record<string, string>>([
        [wrap, fg],
        [kids[0], fg],
        [kids[1], fg],
      ])
    );
    const batch = collectDesignBatch(kids.map((element, i) => ({ id: `k${i}`, element })));
    const metric = customPropertyConsistency(batch.elements, VIEWPORT);
    // html { color: var(--fg) }-style use reaches the children: token-backed
    // colours, but the ancestor's choice, so adoption counts it at half.
    expect(metric.rawData).toMatchObject({
      elementsUsingTokens: 0,
      elementsInheritingTokens: 2,
      inheritedTokenColors: 2,
      inheritedHardcodedColors: 0,
      hardcodedColors: 0,
      adoptionScore: 50,
      avoidanceScore: 100,
    });
    expect(metric.findings.map((f) => f.message)).toContainEqual(
      expect.stringContaining('Token use is mostly inherited')
    );
  });

  it('customPropertyConsistency: an unpainted (transparent) background is not a hardcoded colour', () => {
    sheet(':root { --brand: rgb(31, 78, 140); }');
    const els = [add('div', 'a'), add('div', 'b')];
    for (const el of els) el.style.setProperty('color', 'var(--brand)');
    browserComputes(
      new Map(
        els.map((el) => [el, { color: 'rgb(31, 78, 140)' }] as [Element, Record<string, string>])
      )
    );
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
