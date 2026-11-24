import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { missingOutputMessage } from '../../../test-support/build-if-stale.mjs';
import { parseDensityBudget, parseDensityTargets } from './density/index';

/**
 * `ui-bridge-density assert`, `lint` and `init`, run as the built bin
 * (dist/density-cli.js): every exit code of `assert` (0 clean, 1 any fail,
 * 3 unknowns only, 2 usage) with the three counts it prints, `--draft`
 * writing only null limits, `lint` reporting a quote the profile lacks, and
 * `init` writing an empty, valid targets file and budget file.
 *
 * Every id and text here is synthetic (plan D5). Every expected value is a
 * literal spelled in this file.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change, Phase 6.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(resolve(HERE, '..'), 'dist', 'density-cli.js');

/** A bare snapshot: two registered value rows, unscrolled, at 360x740. */
const SNAPSHOT = {
  timestamp: 1763900000000,
  snapshotId: 'snap-synthetic-assert',
  viewport: {
    viewportWidth: 360,
    viewportHeight: 740,
    scrollX: 0,
    scrollY: 0,
    documentWidth: 360,
    documentHeight: 1200,
    container: 'viewport',
  },
  elements: [0, 1].map((i) => ({
    id: `app.orders.open-${i + 1}`,
    type: 'generic',
    tagName: 'div',
    category: 'content',
    identifier: { xpath: `/html/body/div[${i + 1}]` },
    text: `Order ${i + 1}`,
    state: {
      visible: true,
      rect: { x: 0, y: 100 + i * 40, width: 360, height: 40 },
      textContent: `Order ${i + 1}`,
      computedStyles: {
        fontSize: '14px',
        lineHeight: '20px',
        position: 'static',
        overflow: 'visible',
      },
    },
  })),
  components: [],
};

const budget = (rules: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => ({
  schema: 'ui-bridge/density-budget@1',
  source: 'budget_doc/synthetic@1',
  matrix: [],
  rules,
  ...extra,
});

const PROFILE_DOC = 'audience_profile/synthetic@1';
const PROFILE_TEXT =
  'Buyers check their open orders every morning.\n\nThey rarely read the help.\n';

const targets = (quote: string) => ({
  schema: 'ui-bridge/density-targets@1',
  surface: '/orders',
  profile: PROFILE_DOC,
  roles: [
    {
      role: 'buyer',
      asks: [
        {
          id: 'B1',
          rank: 1,
          weight: 1,
          kind: 'state',
          question: 'Which orders are open?',
          source: { doc: PROFILE_DOC, quote },
          answer: { idPrefix: 'app.orders.open-' },
        },
      ],
    },
  ],
});

let dir = '';
const at = (name: string) => join(dir, name);

function run(args: string[], input?: string) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function writeJson(name: string, value: unknown): string {
  writeFileSync(at(name), JSON.stringify(value));
  return at(name);
}

function assertWith(budgetFile: string) {
  return run(['assert', '--budget', budgetFile, '--snapshot', at('snap.json'), '--role', 'buyer']);
}

beforeAll(() => {
  // Built once by vitest.global-setup.ts before any worker starts.
  expect(existsSync(BIN), missingOutputMessage(BIN)).toBe(true);
  dir = mkdtempSync(join(tmpdir(), 'ui-bridge-density-assert-'));
  writeJson('snap.json', SNAPSHOT);
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('ui-bridge-density assert: exit codes from the built bin', () => {
  it('0 when every rule passes, with the three counts', () => {
    const r = assertWith(
      writeJson('pass.json', budget([{ id: 'items', quantity: 'cell.items', min: 1 }]))
    );
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout) as {
      command: string;
      producer: { id: string };
      counts: unknown;
      cells: Array<{
        observation: {
          status: string;
          value: { results: Array<{ result: string; measured: unknown }> };
        };
      }>;
    };
    expect(doc.command).toBe('assert');
    expect(doc.producer.id).toBe('sdk/density');
    expect(doc.counts).toEqual({ pass: 1, fail: 0, unknown: 0 });
    expect(doc.cells[0].observation.status).toBe('measured');
    expect(doc.cells[0].observation.value.results[0]).toMatchObject({
      result: 'pass',
      measured: { lo: 2, hi: 2 },
    });
  }, 60_000);

  it('1 when any rule fails, even beside an unknown', () => {
    const r = assertWith(
      writeJson(
        'fail.json',
        budget([
          { id: 'items', quantity: 'cell.items', max: 1 },
          { id: 'unset', quantity: 'cell.items', max: null },
        ])
      )
    );
    expect(r.status).toBe(1);
    expect((JSON.parse(r.stdout) as { counts: unknown }).counts).toEqual({
      pass: 0,
      fail: 1,
      unknown: 1,
    });
  }, 60_000);

  it('3 when the only non-passes are unknowns', () => {
    const r = assertWith(
      writeJson(
        'unknown.json',
        budget([
          { id: 'items', quantity: 'cell.items', min: 1 },
          { id: 'unset', quantity: 'cell.items', max: null },
        ])
      )
    );
    expect(r.status).toBe(3);
    const doc = JSON.parse(r.stdout) as { counts: unknown; next: string[] };
    expect(doc.counts).toEqual({ pass: 1, fail: 0, unknown: 1 });
    expect(doc.next).toEqual(['write-targets', 'set-limit']);
  }, 60_000);

  it('3 when a required matrix cell has no capture', () => {
    const r = assertWith(
      writeJson(
        'matrix.json',
        budget([{ id: 'items', quantity: 'cell.items', min: 1 }], {
          matrix: [{ role: 'buyer', viewport: { width: 1280, height: 800 } }],
        })
      )
    );
    expect(r.status).toBe(3);
    const doc = JSON.parse(r.stdout) as {
      counts: unknown;
      cells: Array<{
        required: boolean;
        observation: { status: string; unknown?: { code: string } };
      }>;
    };
    expect(doc.counts).toEqual({ pass: 1, fail: 0, unknown: 1 });
    expect(doc.cells.map((c) => [c.required, c.observation.status])).toEqual([
      [false, 'measured'],
      [true, 'unknown'],
    ]);
    expect(doc.cells[1].observation.unknown!.code).toBe('input_missing');
  }, 60_000);

  it('2 on a budget naming no registered quantity, with nothing on stdout', () => {
    const r = assertWith(
      writeJson('bad.json', budget([{ id: 'x', quantity: 'role.score', max: 1 }]))
    );
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('is not a valid budget file');
    expect(r.stderr).toContain(
      '$.rules[0].quantity: is not a quantity of DENSITY_QUANTITIES: "role.score"'
    );
  }, 60_000);

  it('2 without --budget or --draft', () => {
    const r = run(['assert', '--snapshot', at('snap.json'), '--role', 'buyer']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('assert: --budget or --draft is required');
  }, 60_000);
});

describe('ui-bridge-density assert --draft', () => {
  it('writes only null limits, beside the current values, and exits 0', () => {
    const r = run([
      'assert',
      '--draft',
      at('draft.json'),
      '--snapshot',
      at('snap.json'),
      '--role',
      'buyer',
    ]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as { draft: { rules: number; cells: number }; next: string[] };
    expect(out.draft.cells).toBe(1);
    expect(out.draft.rules).toBeGreaterThan(0);
    expect(out.next).toEqual(['set-limit']);
    const doc = JSON.parse(readFileSync(at('draft.json'), 'utf8')) as {
      rules: Array<Record<string, unknown>>;
    };
    expect(doc.rules).toHaveLength(out.draft.rules);
    expect(doc.rules.every((x) => ('max' in x ? x.max : x.min) === null)).toBe(true);
    expect(doc.rules.find((x) => x.quantity === 'ledger.contentTopPx')).toEqual({
      id: 'ledger.contentTopPx@buyer@360x740',
      quantity: 'ledger.contentTopPx',
      where: { role: 'buyer', viewport: { width: 360, height: 740 } },
      max: null,
      current: { lo: 100, hi: 100 },
    });
    expect(parseDensityBudget(doc).ok).toBe(true);
    // Asserting the draft judges nothing as passed: exit 3.
    expect(assertWith(at('draft.json')).status).toBe(3);
  }, 60_000);
});

describe('ui-bridge-density lint', () => {
  it('0 when every quote is in the profile text, listing the unquoted sentences', () => {
    const t = writeJson('t-ok.json', targets('Buyers check their open orders every morning.'));
    const r = run(['lint', '--targets', t, '--profile-text', '-'], PROFILE_TEXT);
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout) as {
      command: string;
      unquoted: { list: unknown[] };
      next: string[];
    };
    expect(doc.command).toBe('lint');
    expect(doc.unquoted.list).toEqual([{ index: 1, sentence: 'They rarely read the help.' }]);
    expect(doc.next).toEqual(['review-targets']);
  }, 60_000);

  it('1 when a quote is not in the profile text, and names the ask', () => {
    const t = writeJson('t-miss.json', targets('Buyers check their invoices every evening.'));
    writeFileSync(at('profile.md'), PROFILE_TEXT);
    const r = run(['lint', '--targets', t, '--profile-text', at('profile.md')]);
    expect(r.status).toBe(1);
    const doc = JSON.parse(r.stdout) as { asks: unknown[]; counts: unknown };
    expect(doc.asks).toEqual([{ role: 'buyer', ask: 'B1', doc: PROFILE_DOC, status: 'missing' }]);
    expect(doc.counts).toEqual({ found: 0, missing: 1, otherDoc: 0 });
  }, 60_000);

  it('3 when the text is of another document than the asks cite', () => {
    const t = writeJson('t-other.json', targets('Buyers check their open orders every morning.'));
    const r = run(
      ['lint', '--targets', t, '--profile-text', '-', '--profile', 'audience_profile/other@1'],
      PROFILE_TEXT
    );
    expect(r.status).toBe(3);
  }, 60_000);
});

describe('ui-bridge-density init', () => {
  it('writes a valid, empty targets file and budget file: no role, no ask, no limit', () => {
    const t = at('init-targets.json');
    const b = at('init-budget.json');
    const r = run([
      'init',
      '--surface',
      '/orders',
      '--profile',
      PROFILE_DOC,
      '--targets-out',
      t,
      '--budget-out',
      b,
    ]);
    expect(r.status).toBe(0);
    const targetsDoc = JSON.parse(readFileSync(t, 'utf8')) as unknown;
    const budgetDoc = JSON.parse(readFileSync(b, 'utf8')) as unknown;
    expect(targetsDoc).toEqual({
      schema: 'ui-bridge/density-targets@1',
      surface: '/orders',
      profile: PROFILE_DOC,
      classify: [],
      blocks: [],
      roles: [],
      review: null,
    });
    expect(budgetDoc).toEqual({
      schema: 'ui-bridge/density-budget@1',
      source: null,
      matrix: [],
      volume: null,
      rules: [],
    });
    expect(parseDensityTargets(targetsDoc).ok).toBe(true);
    expect(parseDensityBudget(budgetDoc).ok).toBe(true);
    // The empty budget judges nothing: unknown, never clean.
    expect(assertWith(b).status).toBe(3);
  }, 60_000);

  it('never overwrites a file', () => {
    const t = at('exists-targets.json');
    writeFileSync(t, 'kept');
    const r = run([
      'init',
      '--surface',
      '/orders',
      '--profile',
      PROFILE_DOC,
      '--targets-out',
      t,
      '--budget-out',
      at('exists-budget.json'),
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('exists; init never overwrites a file');
    expect(readFileSync(t, 'utf8')).toBe('kept');
    expect(existsSync(at('exists-budget.json'))).toBe(false);
  }, 60_000);
});
