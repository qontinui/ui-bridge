/**
 * routePatternFromParams — the pattern it derives must never carry a param
 * value (plan 2026-10-09-journey-ledger-stores-a-concrete-url-path-as-a-route-pattern,
 * Phase 2). Every case below also runs the leak invariant: no param value, in
 * raw or decoded form, survives as a segment of the output.
 */

import { describe, it, expect } from 'vitest';
import { routePatternFromParams, type RouteParamsInput } from '../routePatternFromParams';
// The public entry point must carry it too.
import { routePatternFromParams as fromReactEntry } from '../index';

function decode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** Assert no param value (raw or decoded, per segment) is a segment of `out`. */
function expectNoValueSurvives(out: string | null, params: RouteParamsInput): void {
  if (out === null || !params) return;
  const segs = new Set(
    out
      .split('/')
      .filter((s) => s !== '')
      .flatMap((s) => [s, decode(s)])
  );
  for (const raw of Object.values(params)) {
    if (raw === undefined) continue;
    const values = Array.isArray(raw) ? raw : [raw as string];
    for (const v of values.flatMap((x) => x.split('/')).filter((x) => x !== '')) {
      expect(segs.has(v), `value "${v}" survived in "${out}"`).toBe(false);
      expect(segs.has(decode(v)), `decoded value "${decode(v)}" survived in "${out}"`).toBe(false);
    }
  }
}

interface Case {
  name: string;
  pathname: string;
  params: RouteParamsInput;
  matched: boolean;
  expected: string | null;
}

const cases: Case[] = [
  {
    name: 'a dynamic segment becomes [name]',
    pathname: '/search/abc',
    params: { term: 'abc' },
    matched: true,
    expected: '/search/[term]',
  },
  {
    name: 'a catch-all string[] run becomes [...name]',
    pathname: '/docs/guides/setup/linux',
    params: { slug: ['guides', 'setup', 'linux'] },
    matched: true,
    expected: '/docs/[...slug]',
  },
  {
    name: 'a single-element catch-all is still [...name]',
    pathname: '/docs/intro',
    params: { slug: ['intro'] },
    matched: true,
    expected: '/docs/[...slug]',
  },
  {
    name: 'a React Router splat string spanning segments becomes [...name]',
    pathname: '/files/a/b/c',
    params: { '*': 'a/b/c' },
    matched: true,
    expected: '/files/[...*]',
  },
  {
    name: 'a static route with no params is unchanged',
    pathname: '/login',
    params: {},
    matched: true,
    expected: '/login',
  },
  {
    name: 'the root is unchanged',
    pathname: '/',
    params: {},
    matched: true,
    expected: '/',
  },
  {
    name: 'null params are treated as none',
    pathname: '/login',
    params: null,
    matched: true,
    expected: '/login',
  },
  {
    name: 'matched:false is null even with params',
    pathname: '/search/abc',
    params: { term: 'abc' },
    matched: false,
    expected: null,
  },
  {
    name: 'matched:false on a 404 with empty params is null',
    pathname: '/search/JP2SENTINEL',
    params: {},
    matched: false,
    expected: null,
  },
  {
    name: 'an encoded segment substitutes against a decoded value',
    pathname: '/search/a%20b',
    params: { term: 'a b' },
    matched: true,
    expected: '/search/[term]',
  },
  {
    name: 'a decoded segment substitutes against an encoded value',
    pathname: '/search/a b',
    params: { term: 'a%20b' },
    matched: true,
    expected: '/search/[term]',
  },
  {
    name: 'an encoded catch-all run substitutes against decoded values',
    pathname: '/docs/a%20b/c%2Fd',
    params: { slug: ['a b', 'c%2Fd'] },
    matched: true,
    expected: '/docs/[...slug]',
  },
  {
    name: 'a malformed escape does not throw and still substitutes raw',
    pathname: '/search/100%',
    params: { term: '100%' },
    matched: true,
    expected: '/search/[term]',
  },
  {
    name: 'two params substitute independently',
    pathname: '/org/acme/repo/widget',
    params: { org: 'acme', repo: 'widget' },
    matched: true,
    expected: '/org/[org]/repo/[repo]',
  },
  {
    name: 'over-templating: a static segment equal to a value is templated too',
    pathname: '/tasks/tasks',
    params: { id: 'tasks' },
    matched: true,
    expected: '/[id]/[id]',
  },
  {
    name: 'a value not present as a segment cannot leak and is ignored',
    pathname: '/marketplace/widget',
    params: { slug: 'widget', other: 'elsewhere' },
    matched: true,
    expected: '/marketplace/[slug]',
  },
  {
    name: 'an empty optional catch-all is ignored',
    pathname: '/docs',
    params: { slug: [] },
    matched: true,
    expected: '/docs',
  },
  {
    name: 'a trailing slash is preserved',
    pathname: '/search/abc/',
    params: { term: 'abc' },
    matched: true,
    expected: '/search/[term]/',
  },
  // Unsubstitutable: a value whose segments cannot all be consumed by a run.
  {
    name: 'a catch-all piece left outside its run gives null',
    pathname: '/docs/a/b/a',
    params: { slug: ['a', 'b'] },
    matched: true,
    expected: null,
  },
  {
    name: 'a value that is literally a template token gives null',
    pathname: '/x/[id]',
    params: { id: '[id]' },
    matched: true,
    expected: null,
  },
  {
    name: 'a doubly encoded segment still substitutes',
    pathname: '/search/a%2520b',
    params: { term: 'a b' },
    matched: true,
    expected: '/search/[term]',
  },
  {
    name: 'a missing pathname gives null',
    pathname: undefined as unknown as string,
    params: { term: 'abc' },
    matched: true,
    expected: null,
  },
];

describe('routePatternFromParams', () => {
  it('is exported from the react entry point', () => {
    expect(fromReactEntry).toBe(routePatternFromParams);
  });

  for (const c of cases) {
    it(c.name, () => {
      const out = routePatternFromParams(c.pathname, c.params, { matched: c.matched });
      expect(out).toBe(c.expected);
      expectNoValueSurvives(out, c.params);
    });
  }

  it('never lets a param value survive, across a generated sweep', () => {
    const values = ['abc', 'a b', 'a%20b', '100%', 'x', 'login', '42', 'é', '%C3%A9'];
    const statics = ['', 'search', 'login', 'x', 'docs'];
    for (const v of values) {
      for (const pre of statics) {
        for (const post of statics) {
          for (const seg of [v, encodeURIComponent(v), encodeURIComponent(encodeURIComponent(v))]) {
            const pathname = ['', pre, seg, post].filter((s, i) => i === 0 || s !== '').join('/');
            const params = { p: v };
            const out = routePatternFromParams(pathname, params, { matched: true });
            expect(out).not.toBeNull();
            expectNoValueSurvives(out, params);
            const arr = { rest: [v, 'tail'] };
            const out2 = routePatternFromParams(`${pathname}/tail`, arr, { matched: true });
            expectNoValueSurvives(out2, arr);
          }
        }
      }
    }
  });
});
