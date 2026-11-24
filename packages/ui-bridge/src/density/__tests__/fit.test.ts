// @vitest-environment node
/**
 * `fit`: asks stacked in rank order at their declared form and the floors,
 * under the chrome of a page of the same shell; the rank at which the fold is
 * crossed, per role and viewport, labelled predicted.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 7).
 */
import { describe, expect, it } from 'vitest';
import { densityFitHeight, fitDensity, type DensityFitReport } from '../fit';
import { DENSITY_TEST_PRODUCER } from './fixtures/snapshot-builder';
import { PLAN_FLOORS, planPageCapture, planTargets } from './fixtures/plan-page';

const AT = '2026-11-24T10:00:00.000Z';

function targets() {
  return planTargets([
    {
      id: 'B4',
      rank: 4,
      weight: 1,
      kind: 'action',
      answer: { ids: ['app.help.p'] },
      form: { rows: 20, lines: 1 },
    },
    {
      id: 'B5',
      rank: 5,
      weight: 1,
      kind: 'lookup',
      answer: { ids: ['app.help.p'] },
      form: { rows: 10, lines: 1 },
    },
  ]);
}

function only(obs: ReturnType<typeof fitDensity>): DensityFitReport {
  expect(obs).toHaveLength(1);
  const o = obs[0].observation;
  if (o.status !== 'measured') throw new Error(`expected measured, got ${JSON.stringify(o)}`);
  return o.value;
}

describe('density fit', () => {
  it('stacks the asks in rank order at the floors and names the rank that crosses the fold', () => {
    // The shell page's first non-chrome leaf is at 100 (under the 64 px fixed header).
    const shell = planPageCapture({ promoY: 100, ordersY: 710, helpY: 1510 }, null);
    const r = only(
      fitDensity({
        producer: DENSITY_TEST_PRODUCER,
        targets: targets(),
        floors: PLAN_FLOORS,
        shells: [shell],
        evaluatedAt: AT,
      })
    );
    expect(r.basis).toBe('predicted');
    expect(r.cell).toEqual({
      role: 'buyer',
      viewport: { width: 1280, height: 800 },
      fixture: null,
    });
    expect(r.chromeTopPx).toBe(100);
    expect(r.foldPx).toBe(800);
    // One line at the floors: 1 · 12 · 1.25 + 2 · 4 = 23 px; an action row is at least 24 px.
    expect(r.asks).toEqual([
      {
        id: 'B1',
        rank: 1,
        kind: 'state',
        weight: 5,
        heightPx: 69,
        topPx: 100,
        bottomPx: 169,
        fits: true,
      },
      {
        id: 'B2',
        rank: 2,
        kind: 'reference',
        weight: 1,
        heightPx: 68,
        topPx: 169,
        bottomPx: 237,
        fits: true,
      },
      {
        id: 'B4',
        rank: 4,
        kind: 'action',
        weight: 1,
        heightPx: 480,
        topPx: 237,
        bottomPx: 717,
        fits: true,
      },
      {
        id: 'B5',
        rank: 5,
        kind: 'lookup',
        weight: 1,
        heightPx: 230,
        topPx: 717,
        bottomPx: 947,
        fits: false,
      },
    ]);
    expect(r.foldCrossedAt).toEqual({ crossed: true, rank: 5, ask: 'B5' });
    expect(r.unanswered).toEqual(['B3']);
    expect(densityFitHeight({ rows: 2, lines: 3 }, 'state', PLAN_FLOORS)).toBe(106);
  });

  it('without floors it answers unknown{no_expectation}', () => {
    const shell = planPageCapture({ promoY: 100, ordersY: 710, helpY: 1510 }, null);
    const [cell] = fitDensity({
      producer: DENSITY_TEST_PRODUCER,
      targets: targets(),
      floors: null,
      shells: [shell],
      evaluatedAt: AT,
    });
    expect(cell.observation.status).toBe('unknown');
    if (cell.observation.status !== 'unknown') return;
    expect(cell.observation.unknown.code).toBe('no_expectation');
  });

  it('an ask with no form leaves the stack below it, and a later crossing, unknown', () => {
    const t = planTargets([
      { id: 'B4', rank: 4, weight: 1, kind: 'lookup', answer: { ids: ['app.help.p'] }, form: null },
      {
        id: 'B5',
        rank: 5,
        weight: 1,
        kind: 'lookup',
        answer: { ids: ['app.help.p'] },
        form: { rows: 40, lines: 1 },
      },
    ]);
    const shell = planPageCapture({ promoY: 100, ordersY: 710, helpY: 1510 }, null);
    const r = only(
      fitDensity({
        producer: DENSITY_TEST_PRODUCER,
        targets: t,
        floors: PLAN_FLOORS,
        shells: [shell],
        evaluatedAt: AT,
      })
    );
    expect(r.asks.slice(2)).toEqual([
      {
        id: 'B4',
        rank: 4,
        kind: 'lookup',
        weight: 1,
        heightPx: null,
        topPx: 237,
        bottomPx: null,
        fits: null,
      },
      {
        id: 'B5',
        rank: 5,
        kind: 'lookup',
        weight: 1,
        heightPx: 920,
        topPx: null,
        bottomPx: null,
        fits: null,
      },
    ]);
    expect(r.foldCrossedAt).toEqual({
      unknown: 'input_missing',
      reason: 'ask B4 declares no form, so the stack below it is unknown',
    });
  });
});
