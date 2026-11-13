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

import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_PROJECTED_NAMES,
  MAX_PROJECTION_NAME_LENGTH,
  ProjectionRequestError,
  cssPropertyName,
  isProjectionRequestError,
  parseProjectionRequest,
  projectElement,
  projectElementDetailed,
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
});

describe('cssPropertyName', () => {
  it('reads a camel-cased name as its CSSOM attribute, and leaves CSS names alone', () => {
    expect(cssPropertyName('borderTopColor')).toBe('border-top-color');
    expect(cssPropertyName('webkitLineClamp')).toBe('-webkit-line-clamp');
    expect(cssPropertyName('cssFloat')).toBe('float');
    expect(cssPropertyName('border-top-color')).toBe('border-top-color');
    expect(cssPropertyName('--Brand-Color')).toBe('--Brand-Color');
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

  it('inside a boundary, a structural ARIA value passes only as tokens or a number', () => {
    const node = el(
      '<div data-bridge-redact="true"><div role="slider" aria-current="page" ' +
        'aria-relevant="additions text" aria-valuemax="-0.5" aria-level="3" ' +
        'aria-sort="Order 4711" aria-pressed="TRUE" aria-valuemin="1e3" aria-busy=" true" ' +
        'aria-setsize="4111-1111">x</div></div>'
    ).firstElementChild!;
    const request = {
      attributes: [
        'aria-current',
        'aria-relevant',
        'aria-valuemax',
        'aria-level',
        'aria-sort',
        'aria-pressed',
        'aria-valuemin',
        'aria-busy',
        'aria-setsize',
      ],
    };
    const { projection, redacted } = projectElementDetailed(node, request);
    expect(projection.attributes).toEqual({
      'aria-current': 'page',
      'aria-relevant': 'additions text',
      'aria-valuemax': '-0.5',
      'aria-level': '3',
      'aria-sort': REDACTED_VALUE,
      'aria-pressed': REDACTED_VALUE,
      'aria-valuemin': REDACTED_VALUE,
      'aria-busy': REDACTED_VALUE,
      'aria-setsize': REDACTED_VALUE,
    });
    expect([...redacted.attributes]).toEqual([
      'aria-sort',
      'aria-pressed',
      'aria-valuemin',
      'aria-busy',
      'aria-setsize',
    ]);
    // `lang` and `dir` are not ARIA: their values are not held to the token shape.
    const lang = el(
      '<div data-bridge-redact="true"><p lang="de-CH" dir="ltr">x</p></div>'
    ).firstElementChild!;
    expect(projectElement(lang, { attributes: ['lang', 'dir'] }).attributes).toEqual({
      lang: 'de-CH',
      dir: 'ltr',
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
    expect(
      projectElement(node, { properties: ['--user', 'color', 'background-image'] }).properties
    ).toEqual({
      '--user': REDACTED_VALUE,
      color: 'rgb(1, 2, 3)',
      'background-image': REDACTED_VALUE,
    });
  });
});

describe('projectElementDetailed', () => {
  const request = {
    properties: ['--tone', 'color'],
    attributes: ['href', 'title', 'lang', 'aria-expanded'],
  };

  it('names each value §4.6 replaced, beside the same projection', () => {
    document.body.innerHTML =
      '<div data-bridge-redact="true"><a href="/pay" title="Card 4111" lang="en" ' +
      'aria-expanded="true" style="--tone: #00aaff; color: rgb(1, 2, 3)">x</a></div>';
    const node = document.querySelector('a')!;
    const { projection, redacted } = projectElementDetailed(node, request);
    expect(projection).toEqual(projectElement(node, request));
    expect([...redacted.properties]).toEqual(['--tone']);
    expect([...redacted.attributes]).toEqual(['href', 'title']);
  });

  it('outside a boundary nothing is redacted — a value that spells the sentinel is a value', () => {
    document.body.innerHTML =
      `<a href="/pay" title="${REDACTED_VALUE}" lang="en" aria-expanded="true" ` +
      'style="--tone: #00aaff; color: rgb(1, 2, 3)">x</a>';
    const node = document.querySelector('a')!;
    const { projection, redacted } = projectElementDetailed(node, request);
    expect(projection.attributes!.title).toBe(REDACTED_VALUE);
    expect(projection.properties!['--tone']).toBe('#00aaff');
    expect(redacted.properties.size).toBe(0);
    expect(redacted.attributes.size).toBe(0);
  });
});
