import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { missingOutputMessage } from '../../../test-support/build-if-stale.mjs';
import { runDensityCli, type DensityCliIo } from './density-cli';

/**
 * `ui-bridge-density plan`, `fit` and `diff`, run as the built bin
 * (dist/density-cli.js) over captures that `measure --capture-out` wrote from
 * synthetic control snapshots, plus their usage errors.
 *
 * Every id and text here is synthetic (plan D5). Every expected value is a
 * literal spelled in this file.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 7).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, '..');
const BIN = join(PKG_DIR, 'dist', 'density-cli.js');

type El = {
  id: string;
  tag: string;
  xpath: string;
  rect: [number, number, number, number];
  font: [number, number];
  text: string;
  fixed?: boolean;
};

function row(e: El): Record<string, unknown> {
  const [x, y, width, height] = e.rect;
  return {
    id: e.id,
    type: 'generic',
    tagName: e.tag,
    category: 'content',
    identifier: { xpath: e.xpath },
    text: e.text,
    state: {
      visible: true,
      rect: { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height },
      textContent: e.text,
      scrollWidth: width,
      clientWidth: width,
      computedStyles: {
        fontSize: `${e.font[0]}px`,
        lineHeight: `${e.font[1]}px`,
        position: e.fixed ? 'fixed' : 'static',
        overflow: 'visible',
      },
    },
  };
}

/** The block page: a fixed header, a promo article, the orders section, the help section. */
function page(l: { promoY: number; ordersY: number; helpY: number }): Record<string, unknown> {
  const els: El[] = [
    {
      id: 'app.header',
      tag: 'header',
      xpath: '/html/body/header',
      rect: [0, 0, 1280, 64],
      font: [16, 24],
      text: 'Synthetic Shop',
      fixed: true,
    },
    {
      id: 'app.promo.p1',
      tag: 'p',
      xpath: '/html/body/main/article/p[1]',
      rect: [16, l.promoY, 600, 300],
      font: [16, 24],
      text: 'Synthetic promo one',
    },
    {
      id: 'app.promo.p2',
      tag: 'p',
      xpath: '/html/body/main/article/p[2]',
      rect: [16, l.promoY + 300, 600, 260],
      font: [16, 24],
      text: 'Synthetic promo two',
    },
    {
      id: 'app.orders.title',
      tag: 'h2',
      xpath: '/html/body/main/section[1]/h2',
      rect: [16, l.ordersY, 600, 30],
      font: [20, 30],
      text: 'Open orders',
    },
    ...[1, 2, 3].map(
      (k): El => ({
        id: `app.orders.row${k}`,
        tag: 'span',
        xpath: `/html/body/main/section[1]/span[${k}]`,
        rect: [16, l.ordersY + 40 + 30 * (k - 1), 600, 20],
        font: [13, 20],
        text: '12,50',
      })
    ),
    {
      id: 'app.help.p',
      tag: 'p',
      xpath: '/html/body/main/section[2]/p',
      rect: [16, l.helpY, 200, 40],
      font: [16, 24],
      text: 'Synthetic help text',
    },
  ];
  return {
    timestamp: 1763900000000,
    snapshotId: 'snap-synthetic-plan',
    viewport: {
      viewportWidth: 1280,
      viewportHeight: 800,
      scrollX: 0,
      scrollY: 0,
      documentWidth: 1280,
      documentHeight: 2400,
      container: 'viewport',
    },
    elements: els.map(row),
    components: [
      {
        id: 'component-0',
        name: 'Component 0',
        actions: [],
        registeredAt: 1763900000000,
        mounted: true,
      },
    ],
  };
}

const TARGETS = {
  schema: 'ui-bridge/density-targets@1',
  surface: '/orders',
  profile: 'audience_profile/synthetic@1',
  roles: [
    {
      role: 'buyer',
      asks: [
        {
          id: 'B1',
          rank: 1,
          weight: 5,
          kind: 'state',
          question: 'Which orders are open?',
          source: { doc: 'audience_profile/synthetic@1', quote: 'Synthetic sentence.' },
          answer: { idPrefix: 'app.orders.row' },
          need: 'all',
          form: { rows: 3, lines: 1 },
        },
        {
          id: 'B2',
          rank: 2,
          weight: 1,
          kind: 'reference',
          question: 'Where is help?',
          source: { doc: 'audience_profile/synthetic@1', quote: 'Synthetic sentence.' },
          answer: { ids: ['app.help.p'] },
          form: { rows: 40, lines: 1 },
        },
      ],
    },
  ],
};

const FLOORS = { fontPx: 12, lineHeightRatio: 1.25, targetPx: 24, rowPadPx: 4 };
/** A budget with floors and no rule: what plan, fit and diff read their floors from. */
const BUDGET = {
  schema: 'ui-bridge/density-budget@1',
  source: null,
  matrix: [],
  floors: FLOORS,
  volume: null,
  rules: [],
};
const DEMOTE = 'demote:path:/html/body/main/article';

let dir = '';
const p = (name: string) => join(dir, name);

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function capture(name: string, snapshot: Record<string, unknown>): void {
  writeFileSync(p(`${name}.snapshot.json`), JSON.stringify(snapshot));
  const r = run([
    'measure',
    '--snapshot',
    p(`${name}.snapshot.json`),
    '--role',
    'buyer',
    '--targets',
    p('targets.json'),
    '--capture-out',
    p(`${name}.capture.json`),
  ]);
  expect(r.stderr).toBe('');
  expect(r.status).toBe(0);
}

beforeAll(() => {
  expect(existsSync(BIN), missingOutputMessage(BIN)).toBe(true);
  dir = mkdtempSync(join(tmpdir(), 'ui-bridge-density-plan-'));
  writeFileSync(p('targets.json'), JSON.stringify(TARGETS));
  writeFileSync(p('budget.json'), JSON.stringify(BUDGET));
  capture('before', page({ promoY: 100, ordersY: 710, helpY: 1510 }));
  // As built: the promo landed one ledger cell (8 px) below where the demote predicts (990:
  // under the help paragraph, with the promo's own 50 px trailing gap).
  capture('after', page({ promoY: 998, ordersY: 100, helpY: 900 }));
}, 120_000);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

interface Delta {
  quantity: string;
  before: unknown;
  after: unknown;
  delta: unknown;
}

describe('ui-bridge-density plan', () => {
  it('lists proposals with evidence, predicted per-cell deltas with bounds, and costs', () => {
    const r = run([
      'plan',
      '--capture',
      p('before.capture.json'),
      '--targets',
      p('targets.json'),
      '--budget',
      p('budget.json'),
    ]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    writeFileSync(p('plan.json'), r.stdout);
    const doc = JSON.parse(r.stdout) as {
      command: string;
      reflow: string;
      orderedBy: unknown;
      floorsGiven: boolean;
      proposals: { total: number; list: Array<Record<string, unknown>> };
      next: string[];
    };
    expect(doc.command).toBe('plan');
    expect(doc.reflow).toBe('column-shift@1');
    expect(doc.orderedBy).toBeNull();
    expect(doc.floorsGiven).toBe(true);
    const ids = doc.proposals.list.map((x) => x.id);
    expect(ids).toContain(DEMOTE);
    const demote = doc.proposals.list.find((x) => x.id === DEMOTE)! as {
      evidence: Array<{ values: Record<string, unknown> }>;
      predicted: Array<{
        observation: { status: string; value: { deltas: Delta[]; bounds: { fontPx: unknown } } };
      }>;
      costs: Array<{ costs: { roles: string[]; interactionsAdded: number } }>;
    };
    expect(demote.evidence[0].values).toMatchObject({ firstScreenPx: 560, claimedWeight: 0 });
    const pred = demote.predicted[0].observation;
    expect(pred.status).toBe('measured');
    expect(
      pred.value.deltas.find((d) => d.quantity === 'ask.first.scrollPx[ask=B2,kind=reference]')
    ).toEqual({
      quantity: 'ask.first.scrollPx[ask=B2,kind=reference]',
      before: 734,
      after: 124,
      delta: -610,
    });
    expect(pred.value.bounds.fontPx).toMatchObject({ min: 13, p10: 13 });
    expect(demote.costs[0].costs).toMatchObject({ roles: [], interactionsAdded: 0 });
    expect(doc.next).toEqual(['review-targets', 'apply', 're-measure']);
  }, 60_000);

  it('diff reports per-quantity deltas and the predictionError of the applied proposal', () => {
    expect(existsSync(p('plan.json'))).toBe(true);
    const r = run([
      'diff',
      '--before',
      p('before.capture.json'),
      '--after',
      p('after.capture.json'),
      '--targets',
      p('targets.json'),
      '--budget',
      p('budget.json'),
      '--plan',
      p('plan.json'),
      '--applied',
      DEMOTE,
    ]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout) as {
      command: string;
      cells: Array<{
        observation: { status: string; value: { deltas: Delta[]; predictionError: unknown[] } };
      }>;
    };
    expect(doc.command).toBe('diff');
    const v = doc.cells[0].observation.value;
    expect(
      v.deltas.find((d) => d.quantity === 'block.topPx[block=path:/html/body/main/article]')
    ).toEqual({
      quantity: 'block.topPx[block=path:/html/body/main/article]',
      before: 100,
      after: 998,
      delta: 898,
    });
    expect(v.predictionError).toEqual([
      {
        proposal: DEMOTE,
        status: 'compared',
        exact: expect.any(Number),
        unknown: expect.any(Array),
        misses: [
          {
            quantity: 'block.pitchPx[block=path:/html/body/main/section[2]]',
            predicted: 90,
            measured: 98,
            error: 8,
          },
          {
            quantity: 'block.topPx[block=path:/html/body/main/article]',
            predicted: 990,
            measured: 998,
            error: 8,
          },
        ],
      },
    ]);
  }, 60_000);
});

describe('ui-bridge-density fit', () => {
  it('names the rank at which the fold is crossed, labelled predicted', () => {
    const r = run([
      'fit',
      '--targets',
      p('targets.json'),
      '--shell',
      p('before.capture.json'),
      '--budget',
      p('budget.json'),
    ]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout) as {
      command: string;
      cells: Array<{ observation: { status: string; value: Record<string, unknown> } }>;
    };
    expect(doc.command).toBe('fit');
    const v = doc.cells[0].observation.value;
    expect(v.basis).toBe('predicted');
    // B1: 3 rows of 23 px from 100 to 169; B2: 40 rows of 23 px, to 1089, past the 800 px fold.
    expect(v.foldCrossedAt).toEqual({ crossed: true, rank: 2, ask: 'B2' });
  }, 60_000);

  it('without floors answers unknown{no_expectation}', () => {
    const r = run(['fit', '--targets', p('targets.json'), '--shell', p('before.capture.json')]);
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout) as {
      cells: Array<{ observation: { status: string; unknown: { code: string } } }>;
    };
    expect(doc.cells[0].observation.status).toBe('unknown');
    expect(doc.cells[0].observation.unknown.code).toBe('no_expectation');
  }, 60_000);
});

describe('ui-bridge-density planning usage errors', () => {
  it.each([
    [['plan'], 'plan: --capture is required'],
    [
      ['plan', '--capture', 'x.json', '--ordered-by', 'meanScrollPx'],
      '--ordered-by expects <quantity>:<ascending|descending>',
    ],
    [['fit', '--shell', 'x.json'], 'fit: --targets is required'],
    [['diff', '--before', 'a.json'], 'diff: --before and --after are required'],
    [['diff', '--before', 'a.json', '--after', 'b.json', '--applied', 'x'], 'no --plan was given'],
  ])(
    '%j is a usage error',
    (args, message) => {
      const r = run(args);
      expect(r.status).toBe(2);
      expect(r.stdout).toBe('');
      expect(r.stderr).toContain(message);
    },
    60_000
  );

  it('a budget whose floors miss one is a usage error naming it', () => {
    writeFileSync(
      p('bad-budget.json'),
      JSON.stringify({ ...BUDGET, floors: { fontPx: 12, lineHeightRatio: 1.25, targetPx: 24 } })
    );
    const r = run([
      'plan',
      '--capture',
      p('before.capture.json'),
      '--budget',
      p('bad-budget.json'),
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('$.floors.rowPadPx: is required');
  }, 60_000);

  it('an --applied id the plan does not hold is a usage error', () => {
    expect(readFileSync(p('plan.json'), 'utf8')).toContain('"command": "plan"');
    const r = run([
      'diff',
      '--before',
      p('before.capture.json'),
      '--after',
      p('after.capture.json'),
      '--plan',
      p('plan.json'),
      '--applied',
      'demote:nothing',
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--applied demote:nothing is not a proposal of --plan');
  }, 60_000);
});

describe('runDensityCli runs the planning verbs', () => {
  it('plans, fits and diffs from saved captures in-process', async () => {
    let stdout = '';
    let stderr = '';
    const io: DensityCliIo = {
      readFile: (path) => readFileSync(path, 'utf8'),
      readStdin: async () => '',
      writeFile: () => {},
      stdout: (t) => {
        stdout += t;
      },
      stderr: (t) => {
        stderr += t;
      },
    };
    const common = ['--targets', p('targets.json'), '--budget', p('budget.json')];
    const plan = await runDensityCli(
      ['plan', '--capture', p('before.capture.json'), ...common],
      io
    );
    expect(stderr).toBe('');
    expect(plan).toBe(0);
    const planDoc = JSON.parse(stdout) as {
      command: string;
      proposals: { list: Array<{ id: string }> };
    };
    expect(planDoc.command).toBe('plan');
    expect(planDoc.proposals.list.map((x) => x.id)).toContain(DEMOTE);

    stdout = '';
    const fit = await runDensityCli(['fit', '--shell', p('before.capture.json'), ...common], io);
    expect(fit).toBe(0);
    const fitDoc = JSON.parse(stdout) as {
      cells: Array<{ observation: { value: { foldCrossedAt: unknown } } }>;
    };
    expect(fitDoc.cells[0].observation.value.foldCrossedAt).toEqual({
      crossed: true,
      rank: 2,
      ask: 'B2',
    });

    stdout = '';
    const diff = await runDensityCli(
      ['diff', '--before', p('before.capture.json'), '--after', p('after.capture.json'), ...common],
      io
    );
    expect(diff).toBe(0);
    const diffDoc = JSON.parse(stdout) as {
      command: string;
      cells: Array<{ observation: { value: { deltas: Delta[] } } }>;
    };
    expect(diffDoc.command).toBe('diff');
    expect(
      diffDoc.cells[0].observation.value.deltas.find(
        (d) => d.quantity === 'ask.first.scrollPx[ask=B2,kind=reference]'
      )
    ).toEqual({
      quantity: 'ask.first.scrollPx[ask=B2,kind=reference]',
      before: 734,
      after: 124,
      delta: -610,
    });
  }, 60_000);
});
