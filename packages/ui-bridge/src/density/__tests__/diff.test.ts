// @vitest-environment node
/**
 * `diff`: per-quantity deltas between two captures of one cell, and the
 * `predictionError` of each proposal applied between them.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 7).
 */
import { describe, expect, it } from 'vitest';
import { densityReportQuantities, diffDensity, type DensityDiffReport } from '../diff';
import { measureDensity } from '../measure';
import { DENSITY_QUANTITIES } from '../quantities';
import { planDensity } from '../plan';
import { DENSITY_TEST_PRODUCER } from './fixtures/snapshot-builder';
import {
  PLAN_FLOORS,
  planCapture,
  planPageCapture,
  planPageElements,
  planTargets,
} from './fixtures/plan-page';

const AT = '2026-11-24T10:00:00.000Z';
const PROMO_BLOCK = 'path:/html/body/main/article';

function diffValue(obs: ReturnType<typeof diffDensity>): DensityDiffReport {
  if (obs.status !== 'measured') throw new Error(`expected measured, got ${JSON.stringify(obs)}`);
  return obs.value;
}

describe('density diff', () => {
  it('diff reports predictionError for an applied proposal', () => {
    const targets = planTargets();
    const before = planPageCapture({ promoY: 100, ordersY: 710, helpY: 1510 }, targets);
    const plan = planDensity([before], {
      producer: DENSITY_TEST_PRODUCER,
      targets,
      floors: PLAN_FLOORS,
      evaluatedAt: AT,
    });
    const demote = plan.proposals.list.find((p) => p.id === `demote:${PROMO_BLOCK}`)!;
    const prediction = demote.predicted[0].observation;
    if (prediction.status !== 'measured') throw new Error('expected a prediction');

    // The page as built: the promo landed 8 px (one ledger cell) lower than predicted (960).
    const after = planPageCapture({ promoY: 968, ordersY: 100, helpY: 900 }, targets);
    const d = diffValue(
      diffDensity(before, after, {
        producer: DENSITY_TEST_PRODUCER,
        targets,
        floors: PLAN_FLOORS,
        applied: [{ id: demote.id, prediction: prediction.value }],
        evaluatedAt: AT,
      })
    );

    // Per-quantity deltas between the two captures.
    expect(d.deltas.find((x) => x.quantity === `block.topPx[block=${PROMO_BLOCK}]`)).toEqual({
      quantity: `block.topPx[block=${PROMO_BLOCK}]`,
      before: 100,
      after: 968,
      delta: 868,
    });
    expect(d.deltas.find((x) => x.quantity === 'role.answeredAt.0')).toEqual({
      quantity: 'role.answeredAt.0',
      before: 0,
      after: 0.625,
      delta: 0.625,
    });
    expect(d.total).toBe(d.deltas.length);
    expect(d.truncated).toBe(false);

    // The prediction was right about everything but where the promo landed,
    // and so how far the help section's block is from it.
    expect(d.predictionError).toHaveLength(1);
    const e = d.predictionError[0];
    expect(e.status).toBe('compared');
    if (e.status !== 'compared') return;
    expect(e.proposal).toBe(demote.id);
    expect(e.misses).toEqual([
      {
        quantity: 'block.pitchPx[block=path:/html/body/main/section[2]]',
        predicted: 60,
        measured: 68,
        error: 8,
      },
      {
        quantity: `block.topPx[block=${PROMO_BLOCK}]`,
        predicted: 960,
        measured: 968,
        error: 8,
      },
    ]);
    expect(e.exact).toBeGreaterThan(50);
    // No control on either page: unknown in both, listed apart, never counted exact.
    expect(e.unknown).toContain('bounds.controls.minSidePx');
    expect(d.unknownBoth).toBeGreaterThan(0);

    // A diff measuring without the floors the plan predicted with compares nothing.
    const other = diffValue(
      diffDensity(before, after, {
        producer: DENSITY_TEST_PRODUCER,
        targets,
        applied: [{ id: demote.id, prediction: prediction.value }],
        evaluatedAt: AT,
      })
    );
    expect(other.predictionError).toEqual([
      {
        proposal: demote.id,
        status: 'unknown',
        code: 'input_missing',
        reason: 'the proposal was predicted against other floors than this diff measures with',
      },
    ]);
  });

  it('a prediction made from another capture is not compared', () => {
    const targets = planTargets();
    const before = planPageCapture({ promoY: 100, ordersY: 710, helpY: 1510 }, targets);
    const other = planPageCapture({ promoY: 100, ordersY: 710, helpY: 1500 }, targets);
    const plan = planDensity([other], {
      producer: DENSITY_TEST_PRODUCER,
      targets,
      floors: PLAN_FLOORS,
      evaluatedAt: AT,
    });
    const p = plan.proposals.list[0];
    const pred = p.predicted[0].observation;
    if (pred.status !== 'measured') throw new Error('expected a prediction');
    const d = diffValue(
      diffDensity(before, before, {
        producer: DENSITY_TEST_PRODUCER,
        targets,
        applied: [{ id: p.id, prediction: pred.value }],
        evaluatedAt: AT,
      })
    );
    expect(d.deltas).toEqual([]);
    expect(d.predictionError).toEqual([
      {
        proposal: p.id,
        status: 'unknown',
        code: 'input_missing',
        reason: 'the proposal was predicted from a different capture than --before',
      },
    ]);
  });

  it('two captures of different cells answer unknown{input_missing}', () => {
    const a = planPageCapture({ promoY: 100, ordersY: 710, helpY: 1510 });
    const b = planCapture(planPageElements({ promoY: 100, ordersY: 710, helpY: 1510 }), {
      targets: planTargets(),
      viewport: { viewportWidth: 360, viewportHeight: 740 },
    });
    const obs = diffDensity(a, b, { producer: DENSITY_TEST_PRODUCER, evaluatedAt: AT });
    expect(obs.status).toBe('unknown');
    if (obs.status !== 'unknown') return;
    expect(obs.unknown.code).toBe('input_missing');
    expect(obs.unknown.detail).toContain('buyer @ 1280x800');
    expect(obs.unknown.detail).toContain('buyer @ 360x740');
  });

  it('every quantity a delta names is a registered quantity, keyed by what it belongs to', () => {
    const targets = planTargets();
    const capture = planPageCapture({ promoY: 100, ordersY: 710, helpY: 1510 }, targets);
    const obs = measureDensity(capture, {
      producer: DENSITY_TEST_PRODUCER,
      targets,
      evaluatedAt: AT,
    });
    if (obs.status !== 'measured') throw new Error('expected measured');
    const q = densityReportQuantities(obs.value);
    const ids = new Set(DENSITY_QUANTITIES.map((x) => x.id));
    const keys = [...q.keys()];
    expect(keys.length).toBeGreaterThan(50);
    expect(keys.filter((k) => !ids.has(k.replace(/\[.*\]$/, '')))).toEqual([]);
    expect(q.get('ask.first.scrollPx[ask=B2,kind=reference]')).toBe(734);
    expect(q.get('role.answeredAt.0')).toBe(0);
  });
});
