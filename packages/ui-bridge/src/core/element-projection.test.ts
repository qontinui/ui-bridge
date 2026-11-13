/**
 * The request-scoped projection (`core/element-projection.ts`): what a request
 * may name, and what a read answers for each name.
 *
 * The transports that carry it — find / discover / element state over the
 * in-process handlers and the relay, and the `ai/assert` style and attribute
 * checks — are pinned in `server/element-projection.transports.test.ts`; real
 * computed styles (the cascade, `var()`, logical longhands) in
 * `core/element-projection.smoke.test.ts`, because jsdom does not compute them.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_PROJECTED_NAMES,
  MAX_PROJECTION_NAME_LENGTH,
  MAX_PROJECTION_QUERY_LENGTH,
  PROJECTABLE_ATTRIBUTES,
  ProjectionRequestError,
  cssPropertyName,
  isProjectableAttribute,
  isProjectionRequestError,
  parseProjectionRequest,
  projectElement,
} from './element-projection';
import { REDACTED_VALUE } from './redaction';

/** The refusal `parseProjectionRequest` throws for `raw`, or a failure when it answers. */
function refusal(
  raw: Parameters<typeof parseProjectionRequest>[0],
  form: 'body' | 'query' = 'body'
): ProjectionRequestError {
  try {
    parseProjectionRequest(raw, form);
  } catch (err) {
    if (isProjectionRequestError(err)) return err;
    throw err;
  }
  throw new Error(`expected a refusal for ${JSON.stringify(raw)}`);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('parseProjectionRequest · property names', () => {
  it('accepts standard longhands, camel-cased attributes, vendor names and custom properties', () => {
    const properties = [
      'border-top-color',
      'border-inline-start-color',
      'outline-offset',
      'hyphens',
      'borderTopColor',
      '-webkit-line-clamp',
      '--color-accent',
      '--größe',
    ];
    expect(parseProjectionRequest({ properties })).toEqual({ properties });
  });

  it.each([
    ['a leading digit', '1color'],
    ['a declaration', 'color: red'],
    ['a semicolon', 'color;'],
    ['a function', 'url(x)'],
    ['a bare dash', '-'],
    ['a bare custom prefix', '--'],
    ['a selector', 'a{b}'],
    ['an escape', 'col\\or'],
    ['an empty name', ''],
  ])('refuses %s with UB-VALIDATION-ERROR', (_label, name) => {
    const err = refusal({ properties: [name] });
    expect(err.code).toBe('UB-VALIDATION-ERROR');
    expect(err.option).toBe('properties');
    expect(err.message).toContain('not a CSS property name');
  });

  it(`refuses a name longer than ${MAX_PROJECTION_NAME_LENGTH} characters`, () => {
    const err = refusal({ properties: [`--${'x'.repeat(MAX_PROJECTION_NAME_LENGTH)}`] });
    expect(err.option).toBe('properties');
    expect(err.message).toContain(`at most ${MAX_PROJECTION_NAME_LENGTH}`);
  });

  it(`reads at most ${MAX_PROJECTED_NAMES} names per list`, () => {
    const names = Array.from({ length: MAX_PROJECTED_NAMES + 1 }, (_, i) => `--t${i}`);
    expect(parseProjectionRequest({ properties: names.slice(0, MAX_PROJECTED_NAMES) })).toEqual({
      properties: names.slice(0, MAX_PROJECTED_NAMES),
    });
    expect(refusal({ properties: names }).message).toContain(`at most ${MAX_PROJECTED_NAMES}`);
  });

  it('the bounds are checked on the list as sent, before it is split or de-duplicated', () => {
    // An array is counted as sent: duplicates are entries too.
    const repeated = Array.from({ length: MAX_PROJECTED_NAMES + 1 }, () => 'color');
    for (const form of ['body', 'query'] as const) {
      expect(refusal({ properties: repeated }, form).message).toBe(
        `\`properties\` names ${MAX_PROJECTED_NAMES + 1} entries; at most ${MAX_PROJECTED_NAMES} are read per request`
      );
    }
    expect(parseProjectionRequest({ properties: repeated.slice(1) })).toEqual({
      properties: ['color'],
    });
    // Refused before an entry is looked at: the bad one is past the bound.
    expect(refusal({ attributes: [...repeated, 42] }).message).toContain(
      `at most ${MAX_PROJECTED_NAMES} are read`
    );

    // The query text is measured before it is split, a repeated key's values together.
    expect(MAX_PROJECTION_QUERY_LENGTH).toBe(
      MAX_PROJECTED_NAMES * (MAX_PROJECTION_NAME_LENGTH + 2)
    );
    const split = vi.spyOn(String.prototype, 'split');
    try {
      const long = ','.repeat(MAX_PROJECTION_QUERY_LENGTH) + 'color';
      expect(refusal({ properties: long }, 'query').message).toContain(
        `is ${MAX_PROJECTION_QUERY_LENGTH + 5} characters long`
      );
      const half = ','.repeat(MAX_PROJECTION_QUERY_LENGTH / 2);
      expect(refusal({ attributes: [half, `${half}lang`] }, 'query').message).toContain(
        `is ${MAX_PROJECTION_QUERY_LENGTH + 4} characters long`
      );
      expect(split).not.toHaveBeenCalled();
    } finally {
      split.mockRestore();
    }
    // Inside the length, the names it splits into are still counted.
    const distinct = Array.from({ length: MAX_PROJECTED_NAMES + 1 }, (_, i) => `--t${i}`);
    expect(refusal({ properties: distinct.join(',') }, 'query').message).toContain(
      `names ${MAX_PROJECTED_NAMES + 1} entries`
    );
    // At the bound, the text is read: empty entries drop, duplicates fold.
    const atBound = `${','.repeat(MAX_PROJECTION_QUERY_LENGTH - 11)}color,color`;
    expect(atBound).toHaveLength(MAX_PROJECTION_QUERY_LENGTH);
    expect(parseProjectionRequest({ properties: atBound }, 'query')).toEqual({
      properties: ['color'],
    });
  });

  it('a body list must be an array of strings', () => {
    expect(refusal({ properties: 'color' }).message).toContain('must be an array of strings');
    expect(refusal({ properties: [1] }).message).toContain('must be an array of strings');
    expect(refusal({ attributes: { lang: true } }).option).toBe('attributes');
  });

  it('the query form reads comma-separated and repeated keys, trimmed and de-duplicated', () => {
    expect(
      parseProjectionRequest(
        { properties: 'color, --brand,,color', attributes: ['lang,dir', 'lang'] },
        'query'
      )
    ).toEqual({ properties: ['color', '--brand'], attributes: ['lang', 'dir'] });
  });

  it('nothing asked — absent or empty lists — is no projection at all', () => {
    expect(parseProjectionRequest(undefined)).toBeUndefined();
    expect(parseProjectionRequest({})).toBeUndefined();
    expect(parseProjectionRequest({ properties: [], attributes: null })).toBeUndefined();
    expect(parseProjectionRequest({ properties: '' }, 'query')).toBeUndefined();
  });
});

describe('parseProjectionRequest · attribute names', () => {
  it('accepts the allow-list and every aria-* name, in any case', () => {
    const attributes = [
      'lang',
      'dir',
      'id',
      'role',
      'title',
      'alt',
      'href',
      'aria-label',
      'ARIA-Expanded',
    ];
    expect(parseProjectionRequest({ attributes })).toEqual({ attributes });
  });

  it.each([
    'onclick',
    'style',
    'class',
    'value',
    'data-secret',
    'aria-',
    'aria-1',
    'placeholder',
    'srcset',
  ])('refuses %s with UB-VALIDATION-ERROR, naming the allow-list', (name) => {
    const err = refusal({ attributes: [name] });
    expect(err.code).toBe('UB-VALIDATION-ERROR');
    expect(err.option).toBe('attributes');
    expect(err.message).toContain('lang, dir, id, role, title, alt, href and aria-*');
  });

  it('the exported allow-list is frozen: a consumer cannot widen what every transport reads', () => {
    expect(Object.isFrozen(PROJECTABLE_ATTRIBUTES)).toBe(true);
    const list = PROJECTABLE_ATTRIBUTES as string[];
    let widened = false;
    try {
      list.push('onclick');
      widened = true;
    } catch {
      // A frozen array refuses the push.
    } finally {
      // Never leave a widened list behind for the rest of the run.
      if (widened) list.pop();
    }
    expect(widened).toBe(false);
    expect(isProjectableAttribute('onclick')).toBe(false);
  });
});

describe('cssPropertyName', () => {
  it('reads a camel-cased name as its CSSOM attribute, and leaves CSS names alone', () => {
    expect(cssPropertyName('borderTopColor')).toBe('border-top-color');
    expect(cssPropertyName('webkitLineClamp')).toBe('-webkit-line-clamp');
    expect(cssPropertyName('cssFloat')).toBe('float');
    expect(cssPropertyName('border-top-color')).toBe('border-top-color');
    expect(cssPropertyName('--Brand-Color')).toBe('--Brand-Color');
  });

  it('reads a hyphenated name in any case as the CSS name — never camel-converts it', () => {
    // CSS property names are ASCII case-insensitive. Camel-converting a
    // hyphenated name read `Border-Top-Color` as `-border--top--color`.
    expect(cssPropertyName('Border-Top-Color')).toBe('border-top-color');
    expect(cssPropertyName('OUTLINE-OFFSET')).toBe('outline-offset');
    expect(cssPropertyName('-Webkit-Line-Clamp')).toBe('-webkit-line-clamp');
  });

  it('reads a capitalised name as the CSS name: a leading capital is a vendor prefix only for Webkit, Moz and Ms', () => {
    // Camel-converting a capitalised word read `Opacity` as `-opacity`.
    expect(cssPropertyName('Opacity')).toBe('opacity');
    expect(cssPropertyName('Color')).toBe('color');
    expect(cssPropertyName('BorderTopColor')).toBe('border-top-color');
    expect(cssPropertyName('COLOR')).toBe('color');
    // The vendor-prefixed CSSOM attributes still convert.
    expect(cssPropertyName('WebkitLineClamp')).toBe('-webkit-line-clamp');
    expect(cssPropertyName('MozAppearance')).toBe('-moz-appearance');
    expect(cssPropertyName('MsTransform')).toBe('-ms-transform');
    expect(cssPropertyName('webkitLineClamp')).toBe('-webkit-line-clamp');
  });

  it('a capitalised name reads the value, keyed as requested', () => {
    document.body.innerHTML = '<button style="opacity: 0.5; color: rgb(1, 2, 3)">x</button>';
    const node = document.body.firstElementChild!;
    expect(projectElement(node, { properties: ['Opacity', 'Color'] })).toEqual({
      properties: { Opacity: '0.5', Color: 'rgb(1, 2, 3)' },
      unmeasured: [],
    });
  });

  it('a hyphenated name in upper case reads the value, keyed as requested', () => {
    document.body.innerHTML = '<button style="border-top-color: rgb(1, 2, 3)">x</button>';
    const node = document.body.firstElementChild!;
    expect(projectElement(node, { properties: ['Border-Top-Color'] })).toEqual({
      properties: { 'Border-Top-Color': 'rgb(1, 2, 3)' },
      unmeasured: [],
    });
  });
});

describe('projectElement · attributes', () => {
  function el(html: string): Element {
    document.body.innerHTML = html;
    return document.body.firstElementChild!;
  }

  it('answers each requested attribute, and null for one the element does not carry', () => {
    const node = el('<a href="/orders" lang="de" title="Orders" aria-expanded="false">x</a>');
    expect(
      projectElement(node, {
        attributes: ['href', 'lang', 'title', 'aria-expanded', 'dir', 'ARIA-EXPANDED'],
      })
    ).toEqual({
      attributes: {
        href: '/orders',
        lang: 'de',
        title: 'Orders',
        'aria-expanded': 'false',
        dir: null,
        'ARIA-EXPANDED': 'false',
      },
      unmeasured: [],
    });
  });

  it('keeps an empty alt distinct from an absent one', () => {
    const node = el('<img alt="" src="x.png">');
    expect(projectElement(node, { attributes: ['alt', 'title'] }).attributes).toEqual({
      alt: '',
      title: null,
    });
  });

  it('inside a redaction boundary, scrubs the values that carry content and keeps structure', () => {
    const node = el(
      '<div data-bridge-redact="true"><a id="pay" role="link" lang="en" dir="ltr" href="/pay?token=s3cret" ' +
        'title="Card 4111" aria-label="Card 4111" aria-describedby="hint" aria-expanded="true" ' +
        'aria-valuetext="4111">x</a></div>'
    ).firstElementChild!;
    expect(
      projectElement(node, {
        attributes: [
          'id',
          'role',
          'lang',
          'dir',
          'aria-expanded',
          'href',
          'title',
          'aria-label',
          'aria-describedby',
          'aria-valuetext',
        ],
      }).attributes
    ).toEqual({
      id: 'pay',
      role: 'link',
      lang: 'en',
      dir: 'ltr',
      'aria-expanded': 'true',
      href: REDACTED_VALUE,
      title: REDACTED_VALUE,
      'aria-label': REDACTED_VALUE,
      'aria-describedby': REDACTED_VALUE,
      'aria-valuetext': REDACTED_VALUE,
    });
  });

  it('outside a boundary, passes the same values through', () => {
    const node = el('<a href="/pay" title="Card" aria-label="Pay">x</a>');
    expect(
      projectElement(node, { attributes: ['href', 'title', 'aria-label'] }).attributes
    ).toEqual({
      href: '/pay',
      title: 'Card',
      'aria-label': 'Pay',
    });
  });

  /** The structural attributes, each with a value of its own shape and one that is page text. */
  const SHAPES: Array<[attribute: string, structural: string, text: string]> = [
    ['aria-invalid', 'spelling', 'Card 4111 declined'],
    ['aria-expanded', 'TRUE', 'expanded for 4111'],
    ['aria-current', 'page', 'Order 77812'],
    ['aria-haspopup', 'listbox', 'Card 4111'],
    ['aria-relevant', 'additions text', 'additions 4111'],
    ['aria-level', '2', 'Card 4111'],
    ['aria-setsize', '-1', '4111 4111'],
    ['dir', 'rtl', 'Card 4111'],
    ['lang', 'de-CH', 'Card 4111'],
  ];

  it('inside a boundary, a structural attribute passes only with a value of its own shape', () => {
    const boundary = el(
      '<div data-bridge-redact="true">' +
        `<a id="structural" ${SHAPES.map(([a, v]) => `${a}="${v}"`).join(' ')}>x</a>` +
        `<a id="text" ${SHAPES.map(([a, , t]) => `${a}="${t}"`).join(' ')}>x</a>` +
        '</div>'
    );
    const structural = boundary.querySelector('#structural')!;
    const text = boundary.querySelector('#text')!;
    const attributes = SHAPES.map(([a]) => a);

    // Its own tokens (any case), a number for a numeric one, a language tag,
    // a direction: structure, readable inside the boundary.
    const asStructure = projectElement(structural, { attributes });
    expect(asStructure.attributes).toEqual(Object.fromEntries(SHAPES.map(([a, v]) => [a, v])));
    expect(asStructure).not.toHaveProperty('redacted');

    // The same names holding page text: the name alone says nothing about the
    // value, so each is scrubbed like free text — and reported as scrubbed.
    const asText = projectElement(text, { attributes });
    expect(asText.attributes).toEqual(
      Object.fromEntries(attributes.map((a) => [a, REDACTED_VALUE]))
    );
    expect(asText.redacted).toEqual(attributes.map((name) => ({ kind: 'attribute', name })));
  });

  it('outside a boundary, a structural attribute holding text is the page’s own value', () => {
    const node = el(`<a ${SHAPES.map(([a, , t]) => `${a}="${t}"`).join(' ')}>x</a>`);
    const projection = projectElement(node, { attributes: SHAPES.map(([a]) => a) });
    expect(projection.attributes).toEqual(Object.fromEntries(SHAPES.map(([a, , t]) => [a, t])));
    expect(projection).not.toHaveProperty('redacted');
  });

  it('inside a boundary, the range values are scrubbed, numbers or not: a range bound can be page data', () => {
    const ranges = ['aria-valuemin', 'aria-valuemax', 'aria-valuenow'];
    const boundary = el(
      '<div><div data-bridge-redact="true">' +
        '<div id="limit" role="meter" aria-valuemin="0" aria-valuemax="4111.50" aria-valuenow="12">x</div>' +
        '</div><div id="open" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="12">y</div></div>'
    );
    const inside = projectElement(boundary.querySelector('#limit')!, { attributes: ranges });
    expect(inside.attributes).toEqual({
      'aria-valuemin': REDACTED_VALUE,
      'aria-valuemax': REDACTED_VALUE,
      'aria-valuenow': REDACTED_VALUE,
    });
    expect(inside.redacted).toEqual(ranges.map((name) => ({ kind: 'attribute', name })));
    // Outside a boundary they are the page's own values.
    expect(projectElement(boundary.querySelector('#open')!, { attributes: ranges })).toEqual({
      attributes: { 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '12' },
      unmeasured: [],
    });
  });

  it('names every scrubbed value in `redacted`, and only those — an absent or structural one is not', () => {
    const node = el(
      '<div data-bridge-redact="true"><a role="link" title="Card 4111" aria-label="Card 4111" aria-expanded="true">x</a></div>'
    ).firstElementChild!;
    const projection = projectElement(node, {
      attributes: ['role', 'title', 'aria-expanded', 'alt', 'aria-label'],
    });
    expect(projection.attributes).toEqual({
      role: 'link',
      title: REDACTED_VALUE,
      'aria-expanded': 'true',
      alt: null,
      'aria-label': REDACTED_VALUE,
    });
    expect(projection.redacted).toEqual([
      { kind: 'attribute', name: 'title' },
      { kind: 'attribute', name: 'aria-label' },
    ]);
  });

  it('a page whose own value IS the sentinel string is not reported as scrubbed', () => {
    const node = el(`<a title="${REDACTED_VALUE}">x</a>`);
    const projection = projectElement(node, { attributes: ['title'] });
    expect(projection.attributes).toEqual({ title: REDACTED_VALUE });
    expect(projection).not.toHaveProperty('redacted');
  });

  it('an element no longer in the document is not read: its boundary cannot be seen from it', () => {
    const node = el(
      '<div data-bridge-redact="true"><a title="Card 4111" lang="en">x</a></div>'
    ).firstElementChild!;
    // Detached, the node has no ancestors: the boundary it sat in is gone from
    // its parent chain, so a read would ship its title unscrubbed.
    node.remove();
    expect(projectElement(node, { attributes: ['title', 'lang'] })).toEqual({
      attributes: {},
      unmeasured: [
        expect.objectContaining({ kind: 'attribute', name: 'title', code: 'input_missing' }),
        expect.objectContaining({ kind: 'attribute', name: 'lang', code: 'input_missing' }),
      ],
    });
  });
});

describe('projectElement · properties', () => {
  it('a row with no DOM node answers every name as unmeasured, never as a value', () => {
    expect(projectElement(undefined, { properties: ['color'], attributes: ['lang'] })).toEqual({
      properties: {},
      attributes: {},
      unmeasured: [
        {
          kind: 'property',
          name: 'color',
          code: 'capability_unavailable_in_build',
          detail: 'this row carries no DOM node to compute a style from',
        },
        {
          kind: 'attribute',
          name: 'lang',
          code: 'capability_unavailable_in_build',
          detail: 'this row carries no DOM node to read an attribute from',
        },
      ],
    });
  });

  it('an element not in the document has no computed style', () => {
    const detached = document.createElement('button');
    detached.style.color = 'red';
    const { properties, unmeasured } = projectElement(detached, { properties: ['color'] });
    expect(properties).toEqual({});
    expect(unmeasured).toEqual([
      expect.objectContaining({ kind: 'property', name: 'color', code: 'input_missing' }),
    ]);
  });

  it('a value the engine does not compute, or a custom property not set, is unmeasured — not ""', () => {
    document.body.innerHTML = '<button style="--set: 4px; color: rgb(1, 2, 3)">x</button>';
    const node = document.body.firstElementChild!;
    const projection = projectElement(node, {
      properties: ['color', '--set', 'colr', '--not-set'],
    });
    expect(projection.properties).toEqual({ color: 'rgb(1, 2, 3)', '--set': '4px' });
    expect(projection.unmeasured).toEqual([
      expect.objectContaining({ name: 'colr', code: 'capability_unavailable_in_build' }),
      expect.objectContaining({ name: '--not-set', code: 'input_missing' }),
    ]);
  });

  it('inside a redaction boundary, scrubs custom properties and string or url() values, not style', () => {
    document.body.innerHTML =
      '<div data-bridge-redact="true"><button style="--user: 4111; color: rgb(1, 2, 3); ' +
      'background-image: url(&quot;/avatar?token=s3cret&quot;)">x</button></div>';
    const node = document.querySelector('button')!;
    const projection = projectElement(node, {
      properties: ['--user', 'color', 'background-image'],
    });
    expect(projection.properties).toEqual({
      '--user': REDACTED_VALUE,
      color: 'rgb(1, 2, 3)',
      'background-image': REDACTED_VALUE,
    });
    // Each scrubbed value is named, so no reader mistakes the sentinel for the page's value.
    expect(projection.redacted).toEqual([
      { kind: 'property', name: '--user' },
      { kind: 'property', name: 'background-image' },
    ]);
  });

  it('outside a boundary, nothing is scrubbed and no `redacted` list is carried', () => {
    document.body.innerHTML = '<button style="--user: 4111; color: rgb(1, 2, 3)">x</button>';
    const projection = projectElement(document.querySelector('button')!, {
      properties: ['--user', 'color'],
    });
    expect(projection).toEqual({
      properties: { '--user': '4111', color: 'rgb(1, 2, 3)' },
      unmeasured: [],
    });
  });

  describe('a property that names something the author chose', () => {
    /**
     * Every name, each answering an unquoted author ident — what a page that
     * names things by record sets, as Chromium serializes it. None holds a
     * quote or a `url(`, so the NAME is what must scrub each one.
     */
    const NAMED: Record<string, string> = {
      'font-family': 'Order4711, sans-serif',
      font: '16px Order4711',
      'font-palette': '--order-4711',
      'font-variant-alternates': 'styleset(order-4711)',
      'counter-reset': 'order-4711 3',
      'counter-set': 'order-4711 1',
      'counter-increment': 'order-4711',
      'list-style-type': 'order-4711',
      'list-style': 'outside none order-4711',
      'animation-name': 'order-4711',
      animation: '1s ease 0s 1 normal none running order-4711',
      'animation-timeline': '--order-4711',
      'transition-property': '--order-4711',
      transition: '--order-4711 1s',
      'will-change': 'order-4711',
      'scroll-timeline-name': '--order-4711',
      'scroll-timeline': '--order-4711 block',
      'view-timeline-name': '--order-4711',
      'view-timeline': '--order-4711 block',
      'timeline-scope': '--order-4711',
      'view-transition-name': 'order-4711',
      'view-transition-class': 'order-4711',
      'anchor-name': '--order-4711',
      'position-anchor': '--order-4711',
      'anchor-scope': '--order-4711',
      'position-try-fallbacks': '--order-4711',
      'position-try': '--order-4711',
      'container-name': 'order-4711',
      container: 'order-4711 / inline-size',
      page: 'order-4711',
      'grid-template-areas': 'order-4711',
      'grid-template-columns': '[order-4711] 1264px',
      'grid-template-rows': '[order-4711] 18px',
      'grid-template': '[order-4711] 1fr / [order-4711] 1fr',
      grid: '[order-4711] 18px / [order-4711] 1264px / none / row / auto / auto',
      'grid-area': 'order-4711',
      'grid-row': 'order-4711',
      'grid-column': 'order-4711',
      'grid-row-start': 'order-4711',
      'grid-row-end': 'order-4711',
      'grid-column-start': 'order-4711',
      'grid-column-end': 'order-4711',
      quotes: 'auto',
      '-webkit-animation-name': 'order-4711',
      '-moz-animation-name': 'order-4711',
      color: 'rgb(1, 2, 3)',
      'border-top-width': '2px',
      display: 'grid',
    };
    const STYLE = ['color', 'border-top-width', 'display'];
    const names = Object.keys(NAMED);

    /** jsdom computes none of these: answer them as a real engine would. */
    function stubComputedStyle(): void {
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        getPropertyValue: (name: string) => NAMED[name] ?? '',
      } as unknown as CSSStyleDeclaration);
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('inside a boundary, is scrubbed whatever its value — the style vocabulary still passes', () => {
      document.body.innerHTML = '<div data-bridge-redact="true"><button>x</button></div>';
      const node = document.querySelector('button')!;
      stubComputedStyle();
      // A CSSOM attribute reads the same property as its CSS name.
      const aliases = ['fontFamily', 'webkitAnimationName', 'gridArea'];
      const projection = projectElement(node, { properties: [...names, ...aliases] });
      const expected: Record<string, string> = {};
      for (const name of names) {
        expected[name] = STYLE.includes(name) ? NAMED[name] : REDACTED_VALUE;
      }
      for (const alias of aliases) expected[alias] = REDACTED_VALUE;
      expect(projection.properties).toEqual(expected);
      // Each scrubbed name is listed, in request order; the style vocabulary is not.
      expect(projection.redacted).toEqual(
        [...names.filter((n) => !STYLE.includes(n)), ...aliases].map((name) => ({
          kind: 'property',
          name,
        }))
      );
      expect(projection.unmeasured).toEqual([]);
    });

    it('outside a boundary, reads as written and carries no `redacted` list', () => {
      document.body.innerHTML = '<button>x</button>';
      const node = document.querySelector('button')!;
      stubComputedStyle();
      const projection = projectElement(node, { properties: names });
      expect(projection.properties).toEqual(NAMED);
      expect(projection.redacted).toBeUndefined();
    });
  });
});
