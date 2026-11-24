// @vitest-environment node
/**
 * The budget half (design test 4): a null limit is unknown and never a pass;
 * an unresolved ask widens the interval, so a rule it straddles is unknown; a
 * compaction rule with neither floors nor a waiver is unknown and flagged
 * `unbounded`; a matrix cell with no capture is unknown; the exit code of the
 * three counts; `--draft` writes only null limits; and `lint` reports a quote
 * the profile text does not hold. Every expected value is a literal. The exit
 * codes are also run against the built bin, in
 * `packages/ui-bridge-headless/src/density-cli.assert.test.ts`.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 6).
 */
import { describe, expect, it } from 'vitest';
import {
  densityBudgetDocument,
  densityBudgetExitCode,
  densityBudgetProblems,
  draftDensityBudget,
  emptyDensityBudget,
  evaluateDensityBudget,
  type DensityBudgetInputCell,
} from '../budget';
import { densityAsksHash } from '../hash';
import { densityLintExitCode, densityProfileSentences, lintDensityTargets } from '../lint';
import { measureDensity } from '../measure';
import {
  parseDensityBudget,
  parseDensityTargets,
  type DensityBudget,
  type DensityTargets,
} from '../schema';
import { DENSITY_TEST_PRODUCER } from './fixtures/snapshot-builder';
import { measurePageCapture, measurePageTargets } from './fixtures/measure-page';

/** The buyer's targets with B5, an ask whose matcher resolves to nothing (weight 2 of 10). */
const UNRESOLVED = measurePageTargets([
  { id: 'B5', rank: 5, weight: 2, kind: 'state', answer: { idPrefix: 'app.missing.' } },
]);

function cellOf(targets: DensityTargets, fixture?: string): DensityBudgetInputCell {
  const capture = measurePageCapture({ fixture }, targets);
  return {
    cell: capture.cell,
    observation: measureDensity(capture, {
      producer: DENSITY_TEST_PRODUCER,
      targets,
      evaluatedAt: '2026-11-24T10:00:00.000Z',
    }),
  };
}

function budget(doc: Record<string, unknown>): DensityBudget {
  const parsed = parseDensityBudget({
    schema: 'ui-bridge/density-budget@1',
    source: 'budget_doc/synthetic@1',
    matrix: [],
    ...doc,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
  expect(densityBudgetProblems(parsed.value)).toEqual([]);
  return parsed.value;
}

it('a null limit answers unknown, never pass', () => {
  const b = budget({
    rules: [{ id: 'r1', quantity: 'ask.first.scrollPx', where: { rank: 1 }, max: null }],
  });
  const report = evaluateDensityBudget(b, [cellOf(measurePageTargets())]);
  const r = report.cells[0].results[0];
  // B1's first answer sits at scroll 0: any limit at all would pass it, so
  // only the null limit can make this unknown.
  expect(r.measured).toEqual({ lo: 0, hi: 0 });
  expect(r.result).toBe('unknown');
  expect(r.code).toBe('no_expectation');
  expect(report.counts).toEqual({ pass: 0, fail: 0, unknown: 1 });
  expect(report.next).toEqual(['set-limit']);
  expect(densityBudgetExitCode(report.counts)).toBe(3);
});

it('runs with no DOM', () => {
  expect(typeof document).toBe('undefined');
});

describe('density budget: rules on intervals', () => {
  it('an unresolved ask widens the interval, so a rule it straddles is unknown', () => {
    // answeredAt[0] reads [0.5, 0.7]: B5's weight (2 of 10) could be answered on the first screen.
    // 0.6 is the interval's midpoint, so a midpoint evaluation would pass the first rule.
    const b = budget({
      rules: [
        { id: 'straddled', quantity: 'role.answeredAt.0', min: 0.6 },
        { id: 'above', quantity: 'role.answeredAt.0', min: 0.75 },
        { id: 'below', quantity: 'role.answeredAt.0', max: 0.8 },
      ],
    });
    const report = evaluateDensityBudget(b, [cellOf(UNRESOLVED)]);
    const byRule = Object.fromEntries(report.cells[0].results.map((r) => [r.rule, r]));
    expect(byRule.straddled.measured).toEqual({ lo: 0.5, hi: 0.7 });
    expect(byRule.straddled.result).toBe('unknown');
    expect(byRule.straddled.code).toBe('input_missing');
    expect(byRule.above.result).toBe('fail');
    expect(byRule.below.result).toBe('pass');
    expect(report.counts).toEqual({ pass: 1, fail: 1, unknown: 1 });
    expect(densityBudgetExitCode(report.counts)).toBe(1);
  });

  it('the same rule passes once the ask resolves', () => {
    const b = budget({ rules: [{ id: 'r', quantity: 'role.answeredAt.0', min: 0.05 }] });
    const report = evaluateDensityBudget(b, [cellOf(measurePageTargets())]);
    expect(report.cells[0].results[0].measured).toEqual({ lo: 0.625, hi: 0.625 });
    expect(report.cells[0].results[0].result).toBe('pass');
    expect(densityBudgetExitCode(report.counts)).toBe(0);
  });

  it('a mean over the asks whose reach is known bounds the mean over all of them from below only', () => {
    // B3 is unanswered (counted in neither); B5 (weight 2) is unresolved, so
    // the known scroll (124 px of B2, weight 1) is spread over weight 8, and
    // the mean has no upper bound.
    const b = budget({ rules: [{ id: 'r', quantity: 'role.meanScrollPx', max: 1000 }] });
    const r = evaluateDensityBudget(b, [cellOf(UNRESOLVED)]).cells[0].results[0];
    expect(r.measured).toEqual({ lo: 15.5, hi: null });
    expect(r.result).toBe('unknown');
  });

  it('a compaction rule with no floors and no waiver is unknown and flagged unbounded', () => {
    const rule = { id: 'pitch', quantity: 'repeat.rowPitchPx', max: 100 };
    const none = evaluateDensityBudget(budget({ rules: [rule] }), [cellOf(measurePageTargets())]);
    const r = none.cells[0].results[0];
    expect(none.floorsBasis).toBe('none');
    expect(r.measured).toEqual({ lo: 30, hi: 30 });
    expect(r.result).toBe('unknown');
    expect(r.code).toBe('no_expectation');
    expect(r.unbounded).toBe(true);

    const floors = { fontPx: 12, lineHeightRatio: 1.2, targetPx: 24, rowPadPx: 4 };
    const held = evaluateDensityBudget(budget({ floors, rules: [rule] }), [
      cellOf(measurePageTargets()),
    ]);
    expect(held.cells[0].results[0].result).toBe('pass');
    expect(held.cells[0].results[0].unbounded).toBeUndefined();

    const waived = evaluateDensityBudget(
      budget({ floorsWaived: 'a synthetic surface with no legibility floor', rules: [rule] }),
      [cellOf(measurePageTargets())]
    );
    expect(waived.floorsBasis).toBe('waived');
    expect(waived.cells[0].results[0].result).toBe('pass');
  });

  it('a rule over several values fails when one fails, and names that value', () => {
    // The ledger share per kind: the chrome share is above 0.01, every other is not checked.
    const b = budget({
      rules: [
        {
          id: 'chrome',
          quantity: 'ledger.firstScreen.share',
          where: { kind: 'chrome' },
          max: 0.01,
        },
      ],
    });
    const r = evaluateDensityBudget(b, [cellOf(measurePageTargets())]).cells[0].results[0];
    expect(r.values.total).toBe(1);
    expect(r.values.list[0].at).toEqual({ kind: 'chrome' });
    expect(r.result).toBe('fail');
  });
});

describe('density budget: the matrix', () => {
  it('a matrix cell with no capture is unknown', () => {
    const b = budget({
      matrix: [
        { role: 'buyer', viewport: { width: 1280, height: 800 } },
        { role: 'buyer', viewport: { width: 360, height: 740 } },
      ],
      rules: [{ id: 'r', quantity: 'role.answeredAt.0', min: 0.05 }],
    });
    const report = evaluateDensityBudget(b, [cellOf(measurePageTargets())]);
    expect(report.cells.map((c) => [c.cell.viewport.width, c.status, c.required])).toEqual([
      [1280, 'measured', true],
      [360, 'not-captured', true],
    ]);
    expect(report.cells[1].results[0].result).toBe('unknown');
    expect(report.cells[1].results[0].code).toBe('input_missing');
    expect(report.cells[1].bounds).toBeNull();
    expect(report.counts).toEqual({ pass: 1, fail: 0, unknown: 1 });
    expect(report.next).toEqual(['capture']);
    expect(densityBudgetExitCode(report.counts)).toBe(3);
  });

  it('each result sits beside its cell bounds', () => {
    const b = budget({ rules: [{ id: 'r', quantity: 'bounds.fontPx.min', min: 10 }] });
    const cell = evaluateDensityBudget(b, [cellOf(measurePageTargets())]).cells[0];
    // The cell's bounds are the measured report's own.
    expect(cell.bounds!.fontPx).toMatchObject({ min: 13, of: 4 });
    expect(cell.results[0].measured).toEqual({ lo: 13, hi: 13 });
    expect(cell.results[0].result).toBe('pass');
  });

  it('a rule no cell matches is unknown, never silently dropped', () => {
    const b = budget({
      rules: [{ id: 'seller', quantity: 'role.answeredAt.0', where: { role: 'seller' }, min: 0.5 }],
    });
    const report = evaluateDensityBudget(b, [cellOf(measurePageTargets())]);
    expect(report.cells[0].results).toEqual([]);
    expect(report.unmatched.map((r) => [r.rule, r.result, r.code])).toEqual([
      ['seller', 'unknown', 'input_missing'],
    ]);
    expect(densityBudgetExitCode(report.counts)).toBe(3);
  });
});

describe('density budget: exit codes and the registry', () => {
  it('1 on any fail, 3 on unknowns only (or nothing judged), 0 when clean', () => {
    expect(densityBudgetExitCode({ pass: 3, fail: 1, unknown: 2 })).toBe(1);
    expect(densityBudgetExitCode({ pass: 3, fail: 0, unknown: 2 })).toBe(3);
    expect(densityBudgetExitCode({ pass: 0, fail: 0, unknown: 0 })).toBe(3);
    expect(densityBudgetExitCode({ pass: 3, fail: 0, unknown: 0 })).toBe(0);
  });

  it('a rule naming no registered quantity, or a where its quantity cannot take, is a problem', () => {
    const parsed = parseDensityBudget({
      schema: 'ui-bridge/density-budget@1',
      source: null,
      matrix: [],
      rules: [
        { id: 'a', quantity: 'role.score', max: 1 },
        { id: 'b', quantity: 'role.answeredAt.0', where: { block: 'x' }, min: 0.5 },
      ],
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
    expect(densityBudgetProblems(parsed.value)).toEqual([
      {
        path: '$.rules[0].quantity',
        message: 'is not a quantity of DENSITY_QUANTITIES: "role.score"',
      },
      { path: '$.rules[1].where.block', message: 'role.answeredAt.0 is not selected by block' },
    ]);
  });

  it('a rule gives exactly one of max and min', () => {
    const parsed = parseDensityBudget({
      schema: 'ui-bridge/density-budget@1',
      source: null,
      matrix: [],
      rules: [{ id: 'a', quantity: 'cell.items', max: 1, min: 0 }],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems).toEqual([
      { path: '$.rules[0]', message: 'must give exactly one of max and min' },
    ]);
  });
});

describe('density budget: --draft and init', () => {
  it('--draft writes only null limits, beside the current values', () => {
    const draft = draftDensityBudget([cellOf(measurePageTargets())]);
    // One rule per drafted quantity's value in this one cell (its asks, blocks and repeats).
    expect(draft.rules.length).toBe(22);
    expect(draft.rules.every((r) => r.limit === null)).toBe(true);
    expect(draft.matrix).toEqual([
      { role: 'buyer', viewport: { width: 1280, height: 800 }, fixture: null },
    ]);
    const k0 = draft.rules.find((r) => r.quantity === 'role.answeredAt.0')!;
    expect(k0).toEqual({
      id: 'role.answeredAt.0@buyer@1280x800',
      quantity: 'role.answeredAt.0',
      where: { role: 'buyer', viewport: { width: 1280, height: 800 } },
      bound: 'min',
      limit: null,
      source: null,
      current: { lo: 0.625, hi: 0.625 },
    });
    // The written file round-trips, and evaluating it judges nothing as passed.
    const doc = JSON.parse(JSON.stringify(densityBudgetDocument(draft))) as {
      rules: Array<Record<string, unknown>>;
    };
    expect(doc.rules.every((r) => ('max' in r ? r.max : r.min) === null)).toBe(true);
    const parsed = parseDensityBudget(doc);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
    const report = evaluateDensityBudget(parsed.value, [cellOf(measurePageTargets())]);
    expect(report.counts.pass).toBe(0);
    expect(report.counts.fail).toBe(0);
    expect(densityBudgetExitCode(report.counts)).toBe(3);
  });

  it('the empty budget is valid and holds no limit', () => {
    const parsed = parseDensityBudget(
      JSON.parse(JSON.stringify(densityBudgetDocument(emptyDensityBudget())))
    );
    expect(parsed).toEqual({ ok: true, value: emptyDensityBudget() });
  });
});

describe('density lint', () => {
  const PROFILE = [
    '# Synthetic buyer',
    '',
    'Buyers check their open orders every morning. They rarely read the help.',
    '',
    '- They compare prices before ordering.',
  ].join('\n');

  function targets(quotes: Array<[string, string]>, review = true): DensityTargets {
    const raw = {
      schema: 'ui-bridge/density-targets@1',
      surface: '/orders',
      profile: 'audience_profile/synthetic@1',
      roles: [
        {
          role: 'buyer',
          asks: quotes.map(([doc, quote], i) => ({
            id: `B${i + 1}`,
            rank: i + 1,
            weight: 1,
            kind: 'state',
            question: 'Synthetic?',
            source: { doc, quote },
            answer: null,
          })),
        },
      ],
    };
    const parsed = parseDensityTargets(raw);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
    if (!review) return parsed.value;
    const hashed = parseDensityTargets({
      ...raw,
      review: { reviewer: 'synthetic', asksHash: densityAsksHash(parsed.value) },
    });
    if (!hashed.ok) throw new Error(JSON.stringify(hashed.problems));
    return hashed.value;
  }

  it('the profile is cut into sentences, markers dropped', () => {
    expect(densityProfileSentences(PROFILE)).toEqual([
      'Synthetic buyer',
      'Buyers check their open orders every morning.',
      'They rarely read the help.',
      'They compare prices before ordering.',
    ]);
  });

  it('a quote that is not in the profile text is reported', () => {
    const report = lintDensityTargets(
      targets([
        ['audience_profile/synthetic@1', 'Buyers check their open orders every morning.'],
        ['audience_profile/synthetic@1', 'Buyers check their invoices every evening.'],
      ]),
      PROFILE
    );
    expect(report.asks.map((a) => [a.ask, a.status])).toEqual([
      ['B1', 'found'],
      ['B2', 'missing'],
    ]);
    expect(report.counts).toEqual({ found: 1, missing: 1, otherDoc: 0 });
    expect(densityLintExitCode(report)).toBe(1);
  });

  it('lists the profile sentences no ask quotes', () => {
    const report = lintDensityTargets(
      targets([
        ['audience_profile/synthetic@1', 'Buyers check their open orders   every morning.'],
      ]),
      PROFILE
    );
    expect(report.unquoted.list).toEqual([
      { index: 0, sentence: 'Synthetic buyer' },
      { index: 2, sentence: 'They rarely read the help.' },
      { index: 3, sentence: 'They compare prices before ordering.' },
    ]);
    expect(report.review).toBe('current');
    expect(report.next).toEqual([]);
    expect(densityLintExitCode(report)).toBe(0);
  });

  it('a quote is found within one paragraph or item, and only on word boundaries', () => {
    const report = lintDensityTargets(
      targets([
        // Spans two paragraphs of the profile.
        ['audience_profile/synthetic@1', 'every morning. They rarely read the help. They compare'],
        // Sits inside a word ("Buyers" holds "uyers").
        ['audience_profile/synthetic@1', 'uyers check their open orders'],
        // A whole-word piece of one sentence.
        ['audience_profile/synthetic@1', 'They rarely read the help.'],
      ]),
      PROFILE
    );
    expect(report.asks.map((a) => a.status)).toEqual(['missing', 'missing', 'found']);
  });

  it('an ask citing another document is not checked against this text, and is never found', () => {
    const report = lintDensityTargets(
      targets([['audience_profile/other@2', 'Buyers check their open orders every morning.']]),
      PROFILE
    );
    expect(report.asks[0].status).toBe('other-doc');
    expect(densityLintExitCode(report)).toBe(3);
  });

  it('a missing or stale review puts review-targets in next', () => {
    const missing = lintDensityTargets(
      targets([['audience_profile/synthetic@1', 'They rarely read the help.']], false),
      PROFILE
    );
    expect(missing.review).toBe('missing');
    expect(missing.next).toEqual(['review-targets']);
    const t = targets([['audience_profile/synthetic@1', 'They rarely read the help.']]);
    const stale = lintDensityTargets(
      { ...t, roles: [{ ...t.roles[0], asks: [{ ...t.roles[0].asks[0], weight: 9 }] }] },
      PROFILE
    );
    expect(stale.review).toBe('stale');
    expect(stale.next).toEqual(['review-targets']);
  });
});

describe('density budget: a value that is only a bound is never judged as a point', () => {
  it('the unclaimed-block count is a lower bound while weight is uncertain, so max 0 is unknown', () => {
    const rule = { id: 'none', quantity: 'role.unclaimedBlocks', max: 0 };
    const capture = (t: DensityTargets) => {
      const c = measurePageCapture({ blocks: ['promo', 'orders'] }, t);
      return {
        cell: c.cell,
        observation: measureDensity(c, {
          producer: DENSITY_TEST_PRODUCER,
          targets: t,
          evaluatedAt: '2026-11-24T10:00:00.000Z',
        }),
      };
    };
    const uncertain = evaluateDensityBudget(budget({ rules: [rule] }), [capture(UNRESOLVED)])
      .cells[0].results[0];
    expect(uncertain.measured).toEqual({ lo: 0, hi: null });
    expect(uncertain.result).toBe('unknown');
    // With every ask resolved the promo block is known unclaimed: the rule fails.
    const known = evaluateDensityBudget(budget({ rules: [rule] }), [capture(measurePageTargets())])
      .cells[0].results[0];
    expect(known.measured).toEqual({ lo: 1, hi: 1 });
    expect(known.result).toBe('fail');
  });

  it('a partial ask bounds its first reach from above and its all reach from below', () => {
    const t = measurePageTargets([
      {
        id: 'B6',
        rank: 6,
        weight: 1,
        kind: 'state',
        answer: [{ idPrefix: 'app.orders.row' }, { idPrefix: 'app.missing.' }],
        need: 'all',
      },
    ]);
    const b = budget({
      rules: [
        { id: 'first', quantity: 'ask.first.scrollPx', where: { ask: 'B6' }, min: 1 },
        { id: 'all', quantity: 'ask.all.scrollPx', where: { ask: 'B6' }, max: 10 },
        { id: 'mean', quantity: 'role.meanScrollPx', max: 1000 },
        { id: 'items', quantity: 'ask.answerItems', where: { ask: 'B6' }, max: 3 },
      ],
    });
    const byRule = Object.fromEntries(
      evaluateDensityBudget(b, [cellOf(t)]).cells[0].results.map((r) => [r.rule, r])
    );
    // The rows sit at scroll 0; an unseen nearer answer can only lower the
    // first reach, an unseen missing one only raise the all reach.
    expect(byRule.first.measured).toEqual({ lo: 0, hi: 0 });
    expect(byRule.first.result).toBe('fail');
    expect(byRule.all.measured).toEqual({ lo: 0, hi: null });
    expect(byRule.all.result).toBe('unknown');
    expect(byRule.mean.measured).toEqual({ lo: 0, hi: null });
    expect(byRule.mean.result).toBe('unknown');
    // Its unresolved matcher may hold more answering leaves.
    expect(byRule.items.measured).toEqual({ lo: 3, hi: null });
    expect(byRule.items.result).toBe('unknown');
  });

  it('the entries past a capped list stand as one unknown that a where.kind still selects', () => {
    const cell = cellOf(measurePageTargets());
    if (cell.observation.status !== 'measured') throw new Error('expected measured');
    const capped = {
      ...cell.observation.value,
      affordances: {
        ...cell.observation.value.affordances,
        shown: 1,
        total: 2,
        truncated: true,
        list: [
          {
            kind: 'disclosure' as const,
            rule: 'aria-expanded' as const,
            id: 'app.more',
            state: 'closed' as const,
            controls: null,
            repeat: null,
            recoverable: null,
            hides: { items: 0, values: 0, chars: 0 },
          },
        ],
      },
    };
    const b = budget({
      rules: [
        { id: 'k', quantity: 'affordance.hidesChars', where: { kind: 'disclosure' }, max: 10 },
      ],
    });
    const r = evaluateDensityBudget(b, [
      { cell: cell.cell, observation: { ...cell.observation, value: capped } },
    ]).cells[0].results[0];
    expect(r.values.list.map((v) => [v.at, v.result])).toEqual([
      [{ affordance: 'app.more', kind: 'disclosure' }, 'pass'],
      [{ remainder: true }, 'unknown'],
    ]);
    expect(r.result).toBe('unknown');
  });

  it('a required matrix cell no rule reaches still counts one unknown', () => {
    const b = budget({
      matrix: [{ role: 'buyer', viewport: { width: 360, height: 740 } }],
      rules: [
        {
          id: 'desktop',
          quantity: 'cell.items',
          where: { viewport: { width: 1280, height: 800 } },
          min: 1,
        },
      ],
    });
    const report = evaluateDensityBudget(b, [cellOf(measurePageTargets())]);
    expect(report.cells.map((c) => [c.status, c.results.length, c.counts])).toEqual([
      ['measured', 1, { pass: 1, fail: 0, unknown: 0 }],
      ['not-captured', 0, { pass: 0, fail: 0, unknown: 1 }],
    ]);
    expect(report.counts).toEqual({ pass: 1, fail: 0, unknown: 1 });
    expect(densityBudgetExitCode(report.counts)).toBe(3);
  });

  it('asks that share a rank draft one rule each, selected by ask id', () => {
    const t = measurePageTargets([
      { id: 'B7', rank: 1, weight: 1, kind: 'state', answer: { ids: ['app.help.p'] } },
    ]);
    const draft = draftDensityBudget([cellOf(t)]);
    const rules = draft.rules.filter((r) => r.quantity === 'ask.first.scrollPx');
    expect(rules.map((r) => [r.id, r.where.ask, r.where.rank])).toEqual([
      ['ask.first.scrollPx@buyer@1280x800#ask=B1', 'B1', undefined],
      ['ask.first.scrollPx@buyer@1280x800#ask=B2', 'B2', undefined],
      ['ask.first.scrollPx@buyer@1280x800#ask=B3', 'B3', undefined],
      ['ask.first.scrollPx@buyer@1280x800#ask=B7', 'B7', undefined],
    ]);
    // B3 is unanswered, so its reach is unknown and carries no current value.
    expect(rules.map((r) => r.current)).toEqual([
      { lo: 0, hi: 0 },
      { lo: 124, hi: 124 },
      null,
      { lo: 124, hi: 124 },
    ]);
  });

  it('a cell measured as unknown drafts no matrix cell and no rule', () => {
    const unknownCell: DensityBudgetInputCell = {
      cell: { role: 'buyer', viewport: { width: 0, height: 0 }, fixture: null },
      observation: {
        status: 'unknown',
        unknown: { code: 'input_missing', detail: 'no viewport block' },
      } as DensityBudgetInputCell['observation'],
    };
    const draft = draftDensityBudget([unknownCell]);
    expect(draft.matrix).toEqual([]);
    expect(draft.rules).toEqual([]);
    expect(parseDensityBudget(JSON.parse(JSON.stringify(densityBudgetDocument(draft)))).ok).toBe(
      true
    );
  });
});
