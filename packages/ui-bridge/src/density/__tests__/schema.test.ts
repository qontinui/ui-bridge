// @vitest-environment node
/** schema.ts: the targets and capture parsers — the typed value, or every problem with its JSON path. */
import { describe, expect, it } from 'vitest';
import { parseDensityCapture, parseDensityTargets } from '../schema';

const ASK = {
  id: 'B1',
  rank: 1,
  weight: 5,
  kind: 'state',
  question: 'Which of my open orders need action today?',
  source: { doc: 'audience_profile/synthetic@1', quote: 'Buyers act on open orders daily.' },
  answer: { idPrefix: 'app.orders.open-' },
  need: 'all',
  via: [],
  findChars: 0,
  form: { rows: 6, lines: 1 },
};

const TARGETS = {
  schema: 'ui-bridge/density-targets@1',
  surface: '/',
  profile: 'audience_profile/synthetic@1',
  classify: [{ match: { idPrefix: 'app.header.' }, kind: 'chrome' }],
  blocks: [{ id: 'company', match: { idPrefix: 'app.overview.company-' } }],
  roles: [{ role: 'buyer', probe: { id: 'app.header.role', includes: 'Buyer' }, asks: [ASK] }],
  review: { reviewer: 'synthetic-reviewer', asksHash: 'a'.repeat(64) },
};

describe('parseDensityTargets', () => {
  it('runs with no DOM', () => {
    expect(typeof document).toBe('undefined');
  });

  it('answers the typed value for the design example', () => {
    const r = parseDensityTargets(TARGETS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.roles[0].asks[0]).toEqual({
      id: 'B1',
      rank: 1,
      weight: 5,
      kind: 'state',
      question: 'Which of my open orders need action today?',
      source: { doc: 'audience_profile/synthetic@1', quote: 'Buyers act on open orders daily.' },
      answer: { idPrefix: 'app.orders.open-' },
      need: 'all',
      via: [],
      findChars: 0,
      form: { rows: 6, lines: 1 },
    });
    expect(r.value.classify).toEqual([{ match: { idPrefix: 'app.header.' }, kind: 'chrome' }]);
    expect(r.value.review).toEqual({ reviewer: 'synthetic-reviewer', asksHash: 'a'.repeat(64) });
  });

  it('fills the stated defaults for omitted optional fields', () => {
    const { need: _n, via: _v, findChars: _f, form: _fo, ...bare } = ASK;
    const r = parseDensityTargets({
      schema: 'ui-bridge/density-targets@1',
      surface: '/',
      profile: 'p',
      roles: [{ role: 'buyer', asks: [{ ...bare, answer: null }] }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.classify).toEqual([]);
    expect(r.value.blocks).toEqual([]);
    expect(r.value.review).toBeNull();
    expect(r.value.roles[0].probe).toBeNull();
    const ask = r.value.roles[0].asks[0];
    expect([ask.need, ask.via, ask.findChars, ask.form, ask.answer]).toEqual([
      'any',
      [],
      0,
      null,
      null,
    ]);
  });

  it('refuses an unknown key, naming its path, rather than dropping it', () => {
    const r = parseDensityTargets({
      ...TARGETS,
      roles: [{ ...TARGETS.roles[0], asks: [{ ...ASK, wieght: 5 }] }],
    });
    expect(r).toEqual({
      ok: false,
      problems: [{ path: '$.roles[0].asks[0].wieght', message: 'is not a known key' }],
    });
  });

  it('refuses an unknown matcher key and an empty matcher', () => {
    const r = parseDensityTargets({
      ...TARGETS,
      classify: [
        { match: { idprefix: 'x' }, kind: 'chrome' },
        { match: {}, kind: 'chrome' },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems).toEqual([
      { path: '$.classify[0].match.idprefix', message: 'is not a known key' },
      { path: '$.classify[1].match', message: 'must give at least one field' },
    ]);
  });

  it('reports every problem at once, each at its path', () => {
    const r = parseDensityTargets({
      schema: 'ui-bridge/density-targets@2',
      surface: '',
      roles: [
        { role: 'buyer', asks: [{ ...ASK, rank: 0, weight: -1, kind: 'sometimes' }, ASK, ASK] },
        { role: 'buyer', asks: [] },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems).toEqual([
      { path: '$.profile', message: 'is required' },
      { path: '$.schema', message: 'must be "ui-bridge/density-targets@1"' },
      { path: '$.roles[0].asks[0].rank', message: 'must be at least 1' },
      { path: '$.roles[0].asks[0].weight', message: 'must be greater than 0' },
      {
        path: '$.roles[0].asks[0].kind',
        message: 'must be one of "state", "lookup", "action", "reference"',
      },
      { path: '$.roles[0].asks[1]', message: 'duplicate ask id "B1"' },
      { path: '$.roles[0].asks[2]', message: 'duplicate ask id "B1"' },
      { path: '$.roles[1]', message: 'duplicate role "buyer"' },
      { path: '$.surface', message: 'must not be empty' },
      { path: '$.profile', message: 'must be a string' },
    ]);
  });

  it('refuses a lone surrogate, which would have no hash', () => {
    const r = parseDensityTargets({ ...TARGETS, surface: 'x' + String.fromCharCode(0xd800) });
    expect(r).toEqual({
      ok: false,
      problems: [
        { path: '$.surface', message: 'must not hold a lone surrogate (it has no UTF-8 form)' },
      ],
    });
  });

  it('refuses a non-object', () => {
    expect(parseDensityTargets([])).toEqual({
      ok: false,
      problems: [{ path: '$', message: 'must be an object' }],
    });
  });
});

describe('parseDensityCapture', () => {
  it('refuses an unknown key in an item', () => {
    const r = parseDensityCapture({
      schema: 'ui-bridge/density-capture@1',
      scope: 'registered',
      cell: { role: null, viewport: { width: 360, height: 740 }, fixture: null },
      viewport: {
        width: 360,
        height: 740,
        scrollX: 0,
        scrollY: 0,
        documentWidth: 360,
        documentHeight: 2000,
        container: 'viewport',
      },
      observedAt: null,
      snapshotId: null,
      route: null,
      capturedBy: { package: '@qontinui/ui-bridge', version: '0.0.0' },
      bases: {
        foldBasis: 'measured',
        pinBasis: 'registered-only',
        scrollBasis: 'page',
        scroller: null,
        contentCap: { status: 'unreported', contentRows: 0 },
      },
      structureResolved: false,
      coverage: { considered: 0, measured: 0, unmeasured: [] },
      probe: null,
      targetsHash: null,
      textMatches: {},
      items: [{ id: 'x', text: 'leaked' }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems[0]).toEqual({ path: '$.items[0].parent', message: 'is required' });
    expect(r.problems).toContainEqual({ path: '$.items[0].text', message: 'is not a known key' });
  });
});
