// @vitest-environment node
/** match.ts: matcher resolution against a capture. */
import { describe, expect, it } from 'vitest';
import { captureDensityFromSnapshot } from '../capture-from-snapshot';
import {
  collectDensityTextMatchers,
  densityMatcherKey,
  resolveDensityMatcher,
  resolveDensityMatchers,
} from '../match';
import { parseDensityTargets, type DensityCapture } from '../schema';
import { DENSITY_TEST_PRODUCER, densityTestSnapshot } from './fixtures/snapshot-builder';

function base(): DensityCapture {
  const obs = captureDensityFromSnapshot(
    densityTestSnapshot({
      elements: [
        { id: 'app.orders.open-1', tag: 'li', role: 'listitem' },
        { id: 'app.orders.open-2', tag: 'li', role: 'listitem' },
        { id: 'app.orders.closed-1', tag: 'li', role: 'listitem' },
        { id: 'app.header.search', tag: 'input', role: 'searchbox', category: 'interactive' },
      ],
    }),
    { producer: DENSITY_TEST_PRODUCER, evaluatedAt: '2026-11-23T10:00:00.000Z' }
  );
  if (obs.status !== 'measured') throw new Error(obs.status);
  return obs.value;
}

describe('resolveDensityMatcher', () => {
  it('runs with no DOM', () => {
    expect(typeof document).toBe('undefined');
  });

  it('ids, idPrefix, idGlob, role and tag each select', () => {
    const c = base();
    const ids = (m: Parameters<typeof resolveDensityMatcher>[1]) => {
      const r = resolveDensityMatcher(c, m);
      return r.status === 'resolved' ? r.ids : r.reason;
    };
    expect(ids({ ids: ['app.orders.open-2', 'app.header.search'] })).toEqual([
      'app.orders.open-2',
      'app.header.search',
    ]);
    expect(ids({ idPrefix: 'app.orders.open-' })).toEqual([
      'app.orders.open-1',
      'app.orders.open-2',
    ]);
    expect(ids({ idGlob: 'app.orders.*-1' })).toEqual(['app.orders.open-1', 'app.orders.closed-1']);
    expect(ids({ idGlob: 'app.orders.open-?' })).toEqual([
      'app.orders.open-1',
      'app.orders.open-2',
    ]);
    expect(ids({ idGlob: 'app.orders' })).toBe('no-match');
    expect(ids({ role: 'searchbox' })).toEqual(['app.header.search']);
    expect(ids({ tag: 'LI' })).toEqual([
      'app.orders.open-1',
      'app.orders.open-2',
      'app.orders.closed-1',
    ]);
  });

  it('a glob ? is one character, even outside the BMP', () => {
    const c = base();
    const astral = { ...c, items: [{ ...c.items[0], id: 'tag-' + String.fromCodePoint(0x1f600) }] };
    expect(resolveDensityMatcher(astral, { idGlob: 'tag-?' }).status).toBe('resolved');
  });

  it('every given field must hold', () => {
    const r = resolveDensityMatcher(base(), {
      idPrefix: 'app.orders.',
      ids: ['app.orders.closed-1', 'app.header.search'],
    });
    expect(r).toEqual({ status: 'resolved', ids: ['app.orders.closed-1'], textUnevaluated: 0 });
  });

  it('a matcher that matches nothing is unresolved, never an absence', () => {
    expect(resolveDensityMatcher(base(), { idPrefix: 'app.nothing.' })).toEqual({
      status: 'unresolved',
      reason: 'no-match',
      textUnevaluated: 0,
    });
  });

  it('within is unresolved while the capture has no structure', () => {
    expect(
      resolveDensityMatcher(base(), { tag: 'li', within: { idPrefix: 'app.orders' } })
    ).toEqual({
      status: 'unresolved',
      reason: 'structure-not-resolved',
      textUnevaluated: 0,
    });
  });

  it('within follows parent links once structure is resolved', () => {
    const c = base();
    const structured: DensityCapture = {
      ...c,
      structureResolved: true,
      items: [
        { ...c.items[0], id: 'app.orders', parent: null },
        { ...c.items[1], id: 'app.orders.row', parent: 'app.orders' },
        { ...c.items[2], id: 'app.orders.row.cell', parent: 'app.orders.row' },
        { ...c.items[3], parent: null },
      ],
    };
    const r = resolveDensityMatcher(structured, {
      within: { ids: ['app.orders'] },
      idPrefix: 'app.',
    });
    expect(r).toEqual({
      status: 'resolved',
      ids: ['app.orders.row', 'app.orders.row.cell'],
      textUnevaluated: 0,
    });
  });

  it('a list of matchers resolves to the union, and keeps each member answer', () => {
    const r = resolveDensityMatchers(base(), [
      { role: 'searchbox' },
      { idPrefix: 'app.missing' },
      { ids: ['app.orders.open-1'] },
    ]);
    expect(r.ids).toEqual(['app.orders.open-1', 'app.header.search']);
    expect(r.results.map((x) => x.status)).toEqual(['resolved', 'unresolved', 'resolved']);
  });
});

describe('collectDensityTextMatchers', () => {
  it('finds every text matcher, nested ones included, once each', () => {
    const parsed = parseDensityTargets({
      schema: 'ui-bridge/density-targets@1',
      surface: '/',
      profile: 'p',
      classify: [{ match: { text: 'Help' }, kind: 'chrome' }],
      blocks: [{ id: 'b', match: { idPrefix: 'x', within: { text: 'Company' } } }],
      roles: [
        {
          role: 'buyer',
          asks: [
            {
              id: 'A',
              rank: 1,
              weight: 1,
              kind: 'lookup',
              question: 'q',
              source: { doc: 'd', quote: 'q' },
              answer: [{ text: 'Help' }, { text: 'Total' }, { idPrefix: 'y' }],
            },
          ],
        },
      ],
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
    expect(collectDensityTextMatchers(parsed.value)).toEqual([
      { text: 'Help' },
      { text: 'Company' },
      { text: 'Total' },
    ]);
  });

  it('a matcher key is the hash of its canonical form, independent of key order', () => {
    expect(densityMatcherKey({ text: 'a', role: 'b' })).toBe(
      densityMatcherKey({ role: 'b', text: 'a' })
    );
    expect(densityMatcherKey({ text: 'a' })).not.toBe(densityMatcherKey({ text: 'b' }));
  });
});
