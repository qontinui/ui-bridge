// @vitest-environment node
/**
 * Design test 2: metamorphic relations of `measure`, each with a literal-value
 * twin. A relation says how a quantity must move when the page changes in a
 * known way; the twin pins the values on both sides, so a relation that holds
 * by accident (both sides wrong the same way) still goes red.
 *
 * The page is captured scrolled (`scrollY` 300), so every value here also
 * shows the first screen is document `y` in `[0, H)`.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 5).
 */
import { describe, expect, it } from 'vitest';
import { measureDensity, type DensityMeasureReport } from '../measure';
import type { DensityTargets } from '../schema';
import { DENSITY_TEST_PRODUCER } from './fixtures/snapshot-builder';
import {
  measurePageCapture,
  measurePageTargets,
  type MeasurePageOptions,
} from './fixtures/measure-page';

function measure(
  o: MeasurePageOptions = {},
  targets: DensityTargets = measurePageTargets()
): DensityMeasureReport {
  const obs = measureDensity(measurePageCapture(o, targets), {
    producer: DENSITY_TEST_PRODUCER,
    targets,
    evaluatedAt: '2026-11-24T10:00:00.000Z',
  });
  if (obs.status !== 'measured') throw new Error(`expected measured, got ${JSON.stringify(obs)}`);
  return obs.value;
}

function ask(r: DensityMeasureReport, id: string) {
  const a = r.role!.asks.find((x) => x.id === id);
  if (!a) throw new Error(`no ask ${id}`);
  return a;
}

const at = (r: DensityMeasureReport, k: number) => r.role!.answeredAt.find((x) => x.k === k)!;

const bound = (v: unknown): { min: number; p10: number } => {
  const b = v as { min?: number; p10?: number };
  if (b.min === undefined || b.p10 === undefined) throw new Error(`no bound: ${JSON.stringify(v)}`);
  return { min: b.min, p10: b.p10 };
};

describe('density measure: metamorphic relations', () => {
  it('a block added above the answers raises foreignPx and never raises answeredAt[0]', () => {
    const before = measure();
    const after = measure({ blocks: ['promo', 'orders'] });

    // The relation.
    expect(ask(after, 'B1').all!.foreignPx!).toBeGreaterThan(ask(before, 'B1').all!.foreignPx!);
    expect(ask(after, 'B2').first!.foreignPx!).toBeGreaterThan(ask(before, 'B2').first!.foreignPx!);
    expect(at(after, 0).lo).toBeLessThanOrEqual(at(before, 0).lo);
    expect(at(after, 0).hi).toBeLessThanOrEqual(at(before, 0).hi);

    // The literal twin. Before: the header (64 px) is all that sits above
    // either answer; the rows are on the first screen and the help paragraph's
    // first line ends at 924, 124 px past the fold: one gesture.
    expect(ask(before, 'B1').all!.foreignPx).toBe(64);
    expect(ask(before, 'B2').first!.foreignPx).toBe(64);
    expect(ask(before, 'B2').first!.scrollPx).toBe(124);
    expect(before.role!.answeredAt).toEqual([
      { k: 0, lo: 0.625, hi: 0.625 },
      { k: 1, lo: 0.75, hi: 0.75 },
      { k: 2, lo: 0.75, hi: 0.75 },
      { k: 3, lo: 0.75, hi: 0.75 },
    ]);
    // After: the promo (580 px of paragraphs) is unclaimed and above both.
    expect(ask(after, 'B1').all!.foreignPx).toBe(644);
    expect(ask(after, 'B2').first!.foreignPx).toBe(644);
    expect(after.role!.answeredAt).toEqual([
      { k: 0, lo: 0, hi: 0 },
      { k: 1, lo: 0.625, hi: 0.625 },
      { k: 2, lo: 0.75, hi: 0.75 },
      { k: 3, lo: 0.75, hi: 0.75 },
    ]);
    expect(after.unclaimed!.list).toEqual([
      { block: 'path:/html/body/main/article', firstScreenPx: 580, displacementPx: 95 },
    ]);
  });

  it('distractor leaves beside an answer leave answeredAt[0] unchanged', () => {
    const before = measure();
    const after = measure({ distractors: true });
    expect(after.structure.structureResolved && after.structure.leaves.count).toBe(
      before.structure.structureResolved ? before.structure.leaves.count + 3 : -1
    );
    expect(at(after, 0)).toEqual(at(before, 0));
    expect(at(after, 0)).toEqual({ k: 0, lo: 0.625, hi: 0.625 });
  });

  it('shrinking every font by 0.8 lowers the font bound in proportion', () => {
    const before = measure();
    const after = measure({ fontScale: 0.8 });
    const b = bound(before.bounds.fontPx);
    const a = bound(after.bounds.fontPx);
    expect(a.min / b.min).toBeCloseTo(0.8, 10);
    expect(a.p10 / b.p10).toBeCloseTo(0.8, 10);
    // Literal twin: the answer leaves are the three rows at 13 px and the help
    // paragraph at 16 px.
    expect(b).toEqual({ min: 13, p10: 13 });
    expect(a.min).toBeCloseTo(10.4, 10);
    expect(a.p10).toBeCloseTo(10.4, 10);
    // Line height scales with the font, so the ratio does not move.
    expect(bound(after.bounds.lineHeightRatio).min).toBeCloseTo(1.5, 10);
    expect(bound(before.bounds.lineHeightRatio).min).toBeCloseTo(1.5, 10);
  });

  it('hoisting an answer block raises answeredAt[0] and moves no bound', () => {
    const before = measure({ blocks: ['promo', 'orders'] });
    const after = measure({ blocks: ['orders', 'promo'] });
    expect(at(after, 0).lo).toBeGreaterThan(at(before, 0).lo);
    expect(after.bounds.fontPx).toEqual(before.bounds.fontPx);
    expect(after.bounds.lineHeightRatio).toEqual(before.bounds.lineHeightRatio);
    expect(after.bounds.textLeaves).toEqual(before.bounds.textLeaves);
    // Literal twin: the price (11 px) is the smallest answer-or-value text on
    // the page, on the first screen before the hoist and below it after.
    expect(at(before, 0)).toEqual({ k: 0, lo: 0, hi: 0 });
    expect(at(after, 0)).toEqual({ k: 0, lo: 0.625, hi: 0.625 });
    expect(bound(after.bounds.fontPx)).toEqual({ min: 11, p10: 11 });
    expect((after.bounds.fontPx as { of: number }).of).toBe(5);
  });

  it('collapsing a block adds exactly one interaction to each ask inside it', () => {
    const targets = measurePageTargets([
      { id: 'B4', rank: 4, weight: 1, kind: 'lookup', answer: { ids: ['app.orders.row2'] } },
    ]);
    const open = measure({ collapsible: 'open' }, targets);
    const closed = measure({ collapsible: 'closed' }, targets);
    // B1 needs all three rows: one toggle opens them all.
    expect(ask(closed, 'B1').all!.interactions! - ask(open, 'B1').all!.interactions!).toBe(1);
    expect(ask(closed, 'B4').first!.interactions! - ask(open, 'B4').first!.interactions!).toBe(1);
    // An ask outside the block is untouched.
    expect(ask(closed, 'B2').first!.interactions).toBe(ask(open, 'B2').first!.interactions);
    // Literal twin.
    expect(ask(open, 'B1').all!.interactions).toBe(0);
    expect(ask(closed, 'B1').all!.interactions).toBe(1);
    expect(ask(closed, 'B1').state).toBe('hidden');
    expect(ask(closed, 'B4').first!.closedAround).toEqual(['app.orders.list']);
    expect(ask(closed, 'B4').first!.interactionsBy).toBe('structure');
  });
});
