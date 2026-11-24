// @vitest-environment node
/**
 * `DENSITY_QUANTITIES`: closed, every entry named with a unit and a
 * definition, and covering every quantity a report emits — a numeric field a
 * report carries that is neither a registered quantity nor listed, with its
 * reason, as not one fails here.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 6).
 */
import { describe, expect, it } from 'vitest';
import { measureDensity, type DensityMeasureReport } from '../measure';
import {
  DENSITY_QUANTITIES,
  DENSITY_REPORT_NON_QUANTITIES,
  densityQuantity,
  densityQuantityValues,
} from '../quantities';
import type { DensityCapture, DensityTargets } from '../schema';
import { DENSITY_TEST_PRODUCER } from './fixtures/snapshot-builder';
import {
  measurePageCapture,
  measurePageTargets,
  type MeasurePageOptions,
} from './fixtures/measure-page';

it('runs with no DOM', () => {
  expect(typeof document).toBe('undefined');
});

function report(
  capture: DensityCapture,
  targets: DensityTargets | null,
  extra: { captures?: DensityCapture[]; volume?: number } = {}
): DensityMeasureReport {
  const obs = measureDensity(capture, {
    producer: DENSITY_TEST_PRODUCER,
    targets,
    evaluatedAt: '2026-11-24T10:00:00.000Z',
    ...extra,
  });
  if (obs.status !== 'measured') throw new Error(`expected measured, got ${JSON.stringify(obs)}`);
  return obs.value;
}

/** Controls, a search box, a truncated label and a disclosure, beside the page's blocks. */
const EXTRA: MeasurePageOptions['extra'] = [
  {
    id: 'app.search',
    tag: 'input',
    role: 'searchbox',
    category: 'interactive',
    xpath: '/html/body/main/section[2]/input',
    rect: [16, 1460, 300, 40],
    text: '',
  },
  {
    id: 'app.help.more',
    tag: 'button',
    category: 'interactive',
    xpath: '/html/body/main/section[2]/button[1]',
    rect: [16, 1520, 120, 40],
    ariaExpanded: false,
    text: 'More',
  },
  {
    id: 'app.help.next',
    tag: 'button',
    category: 'interactive',
    xpath: '/html/body/main/section[2]/button[2]',
    rect: [160, 1520, 120, 40],
    text: 'Next',
  },
  {
    id: 'app.help.code',
    tag: 'span',
    xpath: '/html/body/main/section[2]/span',
    rect: [16, 1580, 80, 20],
    text: 'A long synthetic code that does not fit',
    scrollWidth: 300,
    clientWidth: 80,
    styles: { overflow: 'hidden' },
  },
];

/** Reports that between them carry every section and list a report can hold. */
function reports(): DensityMeasureReport[] {
  const unresolved = measurePageTargets([
    { id: 'B5', rank: 5, weight: 2, kind: 'state', answer: { idPrefix: 'app.missing.' } },
  ]);
  const plain = measurePageTargets();
  const rich: MeasurePageOptions = {
    blocks: ['promo', 'orders'],
    collapsible: 'closed',
    distractors: true,
    footerPx: 40,
    extra: EXTRA,
  };
  const a = measurePageCapture(rich, unresolved);
  const b = measurePageCapture({ ...rich, fixture: 'b' }, unresolved);
  const promo = measurePageCapture({ blocks: ['promo', 'orders'] }, plain);
  return [
    report(a, unresolved, { captures: [a, b], volume: 50 }),
    report(promo, plain),
    report(measurePageCapture({}, null), null),
  ];
}

/** Every numeric leaf of `value`, as a path with array indices written `[]`. */
function numericPaths(value: unknown, path: string, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) numericPaths(v, `${path}[]`, out);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      numericPaths(v, path === '' ? k : `${path}.${k}`, out);
    }
    return;
  }
  if (typeof value === 'number') out.add(path);
}

/** Whether `pattern` (`*` one segment; `[k=n]` read as `[]`) names `path`, or — with `prefix` — an ancestor of it. */
function names(pattern: string, path: string, prefix: boolean): boolean {
  const p = pattern.replace(/\[k=\d+\]/g, '[]').split('.');
  const s = path.split('.');
  if (prefix ? s.length < p.length : s.length !== p.length) return false;
  return p.every((seg, i) => seg === '*' || seg === s[i]);
}

describe('DENSITY_QUANTITIES', () => {
  it('every entry has a unique id, a non-empty unit and a non-empty definition', () => {
    const ids = DENSITY_QUANTITIES.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const x of DENSITY_QUANTITIES) {
      expect(x.unit.length, x.id).toBeGreaterThan(0);
      expect(x.definition.trim().length, x.id).toBeGreaterThan(0);
      expect(x.path.length, x.id).toBeGreaterThan(0);
    }
  });

  it('is closed: neither the registry nor its entries can be changed', () => {
    expect(Object.isFrozen(DENSITY_QUANTITIES)).toBe(true);
    expect(DENSITY_QUANTITIES.every((x) => Object.isFrozen(x))).toBe(true);
    expect(Object.isFrozen(DENSITY_REPORT_NON_QUANTITIES)).toBe(true);
  });

  it('every quantity a report emits is in the registry', () => {
    const emitted = new Set<string>();
    for (const r of reports()) numericPaths(r, '', emitted);
    const unregistered = [...emitted].filter(
      (path) =>
        !DENSITY_QUANTITIES.some((x) => names(x.path, path, x.read !== 'value')) &&
        !DENSITY_REPORT_NON_QUANTITIES.some((n) => names(n.path, path, false))
    );
    expect(unregistered).toEqual([]);
  });

  it('a field a report gains is caught: an unregistered numeric field fails the check', () => {
    // The check above, run over one report with a field no entry names.
    const r = reports()[1] as DensityMeasureReport & { roleScore?: number };
    r.roleScore = 0.5;
    const emitted = new Set<string>();
    numericPaths(r, '', emitted);
    const unregistered = [...emitted].filter(
      (path) =>
        !DENSITY_QUANTITIES.some((x) => names(x.path, path, x.read !== 'value')) &&
        !DENSITY_REPORT_NON_QUANTITIES.some((n) => names(n.path, path, false))
    );
    expect(unregistered).toEqual(['roleScore']);
  });

  it('every registered path is found in some report (no entry names a field the report never carries)', () => {
    const all = reports();
    const neverFound = DENSITY_QUANTITIES.filter((x) =>
      all.every((r) =>
        densityQuantityValues(r, x).every(
          (v) => 'unknown' in v.value && /is not in the report|holds no entry/.test(v.value.reason)
        )
      )
    ).map((x) => x.id);
    expect(neverFound).toEqual([]);
  });
});

describe('densityQuantityValues', () => {
  const [rich, promo, bare] = reports();

  it('reads answeredAt[k] as the interval unresolved weight widens', () => {
    const v = densityQuantityValues(rich, densityQuantity('role.answeredAt.0')!);
    expect(v).toEqual([{ at: {}, value: { lo: 0, hi: 0.2 } }]);
  });

  it('a mean over the known asks is a lower bound while an ask is excluded', () => {
    const v = densityQuantityValues(rich, densityQuantity('role.meanScrollPx')!);
    expect(v).toHaveLength(1);
    expect(v[0].value).toMatchObject({ hi: null });
    // With every ask's reach known, the mean is one number.
    expect(densityQuantityValues(promo, densityQuantity('role.meanScrollPx')!)[0].value).toEqual({
      lo: 147.33333333333334,
      hi: 147.33333333333334,
    });
  });

  it('a per-ask quantity carries the ask, its rank and its kind', () => {
    const v = densityQuantityValues(promo, densityQuantity('ask.first.scrollPx')!);
    expect(v.map((x) => x.at)).toEqual([
      { ask: 'B1', rank: 1, kind: 'state' },
      { ask: 'B2', rank: 2, kind: 'reference' },
      { ask: 'B3', rank: 3, kind: 'lookup' },
    ]);
    // B3 is unanswered (answer: null): its reach is unknown, never 0.
    expect(v[2].value).toMatchObject({ unknown: 'input_missing' });
  });

  it('a map quantity carries its key as the kind', () => {
    const v = densityQuantityValues(promo, densityQuantity('ledger.firstScreen.share')!);
    expect(v.map((x) => x.at.kind)).toEqual([
      'chrome',
      'answer',
      'value',
      'control',
      'label',
      'heading',
      'prose',
      'media',
      'other',
      'uncovered',
    ]);
  });

  it('a role quantity of a report with no targets is unknown, never zero', () => {
    expect(densityQuantityValues(bare, densityQuantity('role.unanswered')!)).toEqual([
      {
        at: {},
        value: { unknown: 'input_missing', reason: 'role: is not in the report' },
      },
    ]);
  });
});
