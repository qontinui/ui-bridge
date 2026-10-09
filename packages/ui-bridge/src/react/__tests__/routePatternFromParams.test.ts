/**
 * routePatternFromParams — the pattern it derives must never carry a param
 * value (plan 2026-10-09-journey-ledger-stores-a-concrete-url-path-as-a-route-pattern,
 * Phase 2). Every case below also runs the leak invariant: no fully decoded
 * form of any non-template output segment CONTAINS any decoded form of any
 * param value, unsplit or per `/`-piece.
 */

import { describe, it, expect } from 'vitest';
import { routePatternFromParams, type RouteParamsInput } from '../routePatternFromParams';
// The public entry point must carry it too.
import { routePatternFromParams as fromReactEntry } from '../index';

/** Every successive decode of `v`, to a fixed point (bounded generously). */
function allForms(v: string): string[] {
  const out = [v];
  let cur = v;
  for (let i = 0; i < 20; i++) {
    let next: string;
    try {
      next = decodeURIComponent(cur);
    } catch {
      break;
    }
    if (next === cur) break;
    out.push(next);
    cur = next;
  }
  return out;
}

const TOKEN = /^\[(\.\.\.)?[^\]/]+\]$/;

/**
 * Assert no param value survives in `out`, by containment. Written
 * independently of the implementation: a template token is skipped only when
 * no value equals it in any form.
 */
function expectNoValueSurvives(out: string | null, params: RouteParamsInput): void {
  if (out === null || !params) return;
  expect(out.includes('?') || out.includes('#'), `query/fragment in "${out}"`).toBe(false);
  const needles = new Set<string>();
  for (const raw of Object.values(params)) {
    if (raw === undefined) continue;
    const values = Array.isArray(raw) ? (raw as string[]) : [raw as string];
    for (const v of [values.join('/'), ...values, ...values.flatMap((x) => x.split('/'))]) {
      for (const f of allForms(v)) if (f !== '') needles.add(f);
    }
  }
  for (const seg of out.split('/')) {
    if (seg === '') continue;
    const segForms = allForms(seg);
    if (TOKEN.test(seg)) {
      for (const f of segForms) expect(needles.has(f), `value equals token "${seg}"`).toBe(false);
      continue;
    }
    for (const f of segForms) {
      for (const n of needles) {
        expect(f.includes(n), `value "${n}" survives inside segment "${seg}" of "${out}"`).toBe(
          false
        );
      }
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
    name: "React Router's `*` splat is a catch-all even over one segment",
    pathname: '/files/a',
    params: { '*': 'a' },
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
    name: 'a param value absent from the pathname is ignored',
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
  // Leaks found by review of b115f3d — each returned the concrete path.
  {
    name: 'an encoded slash inside one segment substitutes as one param',
    pathname: '/files/c%2Fd',
    params: { id: 'c/d' },
    matched: true,
    expected: '/files/[id]',
  },
  {
    name: 'a value sharing a segment with static text gives null',
    pathname: '/files/abc.json',
    params: { id: 'abc' },
    matched: true,
    expected: null,
  },
  {
    name: 'a pathname carrying a query and fragment gives null',
    pathname: '/search/abc?q=secret#h',
    params: { term: 'abc' },
    matched: true,
    expected: null,
  },
  {
    name: 'a pathname carrying only a fragment gives null',
    pathname: '/search/abc#h',
    params: { term: 'abc' },
    matched: true,
    expected: null,
  },
  {
    name: 'a segment encoded past the decode bound gives null',
    pathname: `/search/${[1, 2, 3, 4, 5].reduce((v) => encodeURIComponent(v), 'a b')}`,
    params: { term: 'a b' },
    matched: true,
    expected: null,
  },
  {
    name: 'a value embedded in a longer segment gives null',
    pathname: '/marketplace/xwidgetx',
    params: { slug: 'widget' },
    matched: true,
    expected: null,
  },
  {
    name: 'a short value contained in a static segment over-nulls (the allowed direction)',
    pathname: '/v1/items/1',
    params: { id: '1' },
    matched: true,
    expected: null,
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
    const values = ['abc', 'a b', 'a%20b', '100%', 'x', 'login', '42', 'é', '%C3%A9', 'c/d'];
    const statics = ['', 'search', 'login', 'x', 'docs'];
    const wraps: [string, string][] = [
      ['', ''],
      ['pre-', ''],
      ['', '.json'],
      ['(', ')'],
    ];
    const tails = ['', '?q=secret', '#frag', '?q=1#f'];
    const encode = (v: string, n: number) =>
      Array.from({ length: n }).reduce<string>((acc) => encodeURIComponent(acc), v);
    for (const v of values) {
      for (const pre of statics) {
        for (const post of statics) {
          for (const [wl, wr] of wraps) {
            for (const tail of tails) {
              for (const n of [0, 1, 2, 5]) {
                const seg = `${wl}${encode(v, n)}${wr}`;
                const pathname =
                  ['', pre, seg, post].filter((s, i) => i === 0 || s !== '').join('/') + tail;
                const params = { p: v };
                const out = routePatternFromParams(pathname, params, { matched: true });
                expectNoValueSurvives(out, params);
                const arr = { rest: [v, 'tail'] };
                const out2 = routePatternFromParams(`${pathname}/tail`, arr, { matched: true });
                expectNoValueSurvives(out2, arr);
              }
            }
          }
        }
      }
    }
  });

  // The static prefix is `q` because containment over-nulls: `/search/c%2Fd`
  // for `c/d` is null, since `search` contains the piece `c`.
  it('templates a bare dynamic segment within the decode bound', () => {
    for (const v of ['abc', 'a b', 'é', 'c/d']) {
      for (const n of [0, 1, 2]) {
        let seg = v;
        for (let i = 0; i < n; i++) seg = encodeURIComponent(seg);
        if (n === 0 && v.includes('/')) continue; // a raw slash is two segments
        expect(routePatternFromParams(`/q/${seg}`, { term: v }, { matched: true })).toBe(
          '/q/[term]'
        );
      }
    }
  });
});
