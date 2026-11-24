// @vitest-environment node
/**
 * The planning half's generators and what every proposal carries: evidence,
 * per-cell predicted deltas with bounds, costs, conflicts; compactions only
 * against floors; no font size changed; unranked unless `orderedBy` is named.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 7).
 */
import { describe, expect, it } from 'vitest';
import { applyDensityEdits } from '../edits';
import {
  DensityPlanError,
  planDensity,
  type DensityPlanOptions,
  type DensityProposal,
} from '../plan';
import type { DensityCapture, DensityTargets } from '../schema';
import { DENSITY_TEST_PRODUCER, type DensityTestElementSpec } from './fixtures/snapshot-builder';
import {
  PLAN_FLOORS,
  listPageElements,
  planCapture,
  planPageCapture,
  planTargets,
} from './fixtures/plan-page';

const AT = '2026-11-24T10:00:00.000Z';

function plan(
  captures: DensityCapture[],
  targets: DensityTargets | null,
  o: Partial<DensityPlanOptions> = {}
): DensityProposal[] {
  return planDensity(captures, {
    producer: DENSITY_TEST_PRODUCER,
    targets,
    floors: PLAN_FLOORS,
    evaluatedAt: AT,
    ...o,
  }).proposals.list;
}

function byId(list: DensityProposal[], id: string): DensityProposal {
  const p = list.find((x) => x.id === id);
  if (!p) throw new Error(`no proposal ${id}; have ${list.map((x) => x.id).join(', ')}`);
  return p;
}

function predicted(p: DensityProposal, cell = 0) {
  const o = p.predicted[cell].observation;
  if (o.status !== 'measured') throw new Error(`expected a prediction, got ${JSON.stringify(o)}`);
  return o.value;
}

const delta = (p: DensityProposal, quantity: string) =>
  predicted(p).deltas.find((d) => d.quantity === quantity)?.delta;

const PROMO_BLOCK = 'path:/html/body/main/article';
const ORDERS_BLOCK = 'path:/html/body/main/section[1]';

/** A page that fires chrome, dedupe, one-line and pitch: a side navigation and two-line rows. */
function kitchenElements(): DensityTestElementSpec[] {
  const els: DensityTestElementSpec[] = [
    {
      id: 'app.header',
      tag: 'header',
      xpath: '/html/body/header',
      rect: [0, 0, 1280, 64],
      styles: { position: 'fixed', fontSize: '16px', lineHeight: '24px' },
      text: 'Synthetic Shop',
    },
  ];
  for (let k = 1; k <= 4; k++) {
    els.push({
      id: `app.nav.link${k}`,
      tag: 'a',
      category: 'interactive',
      xpath: `/html/body/nav/a[${k}]`,
      rect: [16, 80 + 40 * (k - 1), 180, 32],
      href: `/synthetic/${k}`,
      styles: { fontSize: '14px', lineHeight: '20px' },
      text: `Section ${k}`,
    });
  }
  for (let k = 1; k <= 3; k++) {
    const y = 100 + 60 * (k - 1);
    const row = `/html/body/main/section[1]/div[${k}]`;
    els.push(
      { id: `app.rows.row${k}`, tag: 'div', xpath: row, rect: [240, y, 600, 48] },
      {
        id: `app.rows.label${k}`,
        tag: 'span',
        xpath: `${row}/span[1]`,
        rect: [240, y + 4, 200, 20],
        styles: { fontSize: '14px', lineHeight: '20px' },
        text: `Synthetic label ${k}`,
      },
      {
        id: `app.rows.value${k}`,
        tag: 'span',
        xpath: `${row}/span[2]`,
        rect: [240, y + 24, 150, 20],
        styles: { fontSize: '14px', lineHeight: '20px' },
        text: '12,50',
      }
    );
  }
  els.push({
    id: 'app.content.link',
    tag: 'a',
    category: 'interactive',
    xpath: '/html/body/main/section[2]/a',
    rect: [240, 400, 120, 32],
    href: '/synthetic/2',
    styles: { fontSize: '14px', lineHeight: '20px' },
    text: 'Section 2',
  });
  return els;
}

describe('density plan', () => {
  it('a compaction with no floors answers unknown{no_expectation}', () => {
    const capture = planCapture(listPageElements({ rows: 5, pitch: 48, helpY: 400 }));
    const list = plan([capture], planTargets(), { floors: null });
    const p = byId(list, 'pitch:repeat:app.list.row1');
    expect(p.compaction).toBe(true);
    expect(p.edits).toBeNull();
    expect(p.predicted).toHaveLength(1);
    const o = p.predicted[0].observation;
    expect(o.status).toBe('unknown');
    if (o.status !== 'unknown') return;
    expect(o.unknown.code).toBe('no_expectation');
    expect(p.costs).toEqual([{ cell: capture.cell, costs: null }]);
    // The evidence still says what fired it.
    expect(p.evidence[0].values).toMatchObject({ rowPitchPx: 48, rowTextPx: 20 });

    // With floors the same repeat is planned: 1 line · 16 px · 1.25 + 2 · 4 px = 28 px.
    const floored = byId(plan([capture], planTargets()), 'pitch:repeat:app.list.row1');
    expect(floored.evidence[0].values.targetPitchPx).toBe(28);
    expect(floored.edits).toEqual(
      [1, 2, 3, 4, 5].map((k) => ({ op: 'resize', subject: [`app.list.row${k}`], deltaPx: -20 }))
    );
    expect(delta(floored, 'repeat.rowPitchPx[repeat=repeat:app.list.row1]')).toBe(-20);
  });

  it('a collapse lists the asks it makes worse under costs', () => {
    const targets = planTargets([
      { id: 'B4', rank: 4, weight: 1, kind: 'reference', answer: { ids: ['app.promo.price'] } },
    ]);
    const capture = planPageCapture({ promoY: 240, ordersY: 100, helpY: 900 }, targets);
    const p = byId(plan([capture], targets), `disclose:${PROMO_BLOCK}`);
    expect(p.edits).toEqual([
      {
        op: 'collapse',
        subject: ['app.promo.p1', 'app.promo.p2', 'app.promo.price'],
        summaryPx: 24,
        toggle: `density-plan:disclose:${PROMO_BLOCK}:toggle`,
        container: `density-plan:disclose:${PROMO_BLOCK}:content`,
      },
    ]);
    // B4 is inside the block: one interaction to open it, 24 px further down. B2 (the help paragraph) rises 566 px and saves
    // its one gesture; that saving offsets nothing.
    expect(p.costs).toEqual([
      {
        cell: capture.cell,
        costs: {
          cell: capture.cell,
          roles: ['buyer'],
          // The price (11 px) is under the 12 px floor before and after: no availability to lose.
          asks: [{ ask: 'B4', interactionsAdded: 1, scrollAddedPx: 24, availabilityLost: false }],
          interactionsAdded: 1,
          unknownAsks: [],
        },
      },
    ]);
    expect(delta(p, 'ask.first.actions[ask=B2,kind=reference]')).toBe(-1);
    expect(delta(p, 'ask.first.scrollPx[ask=B2,kind=reference]')).toBe(-124);
  });

  it('no proposal changes a font size', () => {
    const capture = planCapture(kitchenElements(), { targets: planTargets() });
    const list = plan([capture], planTargets());
    expect(list.map((p) => p.generator).sort()).toEqual(
      // The navigation's four links are a repeat too: its 40 px pitch is over the 24 px target.
      ['chrome', 'dedupe', 'one-line', 'pitch', 'pitch'].sort()
    );
    const fonts = new Map(capture.items.map((i) => [i.id, [i.fontPx, i.lineHeightPx]]));
    for (const p of list) {
      expect(JSON.stringify(p.edits)).not.toMatch(/font|lineHeight/i);
      const r = applyDensityEdits(capture, p.edits!);
      expect(r.ok ? true : JSON.stringify(r)).toBe(true);
      if (!r.ok) continue;
      for (const item of r.capture.items) {
        if (fonts.has(item.id))
          expect([item.fontPx, item.lineHeightPx]).toEqual(fonts.get(item.id));
      }
    }
  });

  it('every proposal carries evidence, per-cell predicted deltas with bounds, costs and conflicts', () => {
    const capture = planPageCapture({ promoY: 100, ordersY: 710, helpY: 1510 });
    const list = plan([capture], planTargets());
    expect(list.map((p) => p.id)).toEqual([
      `demote:${PROMO_BLOCK}`,
      `order:${PROMO_BLOCK}>${ORDERS_BLOCK}`,
      'pitch:repeat:app.orders.row1',
      'disclose:path:/html/body/main/section[2]',
    ]);
    const demote = byId(list, `demote:${PROMO_BLOCK}`);
    expect(demote.evidence).toEqual([
      {
        cell: capture.cell,
        trigger:
          'firstScreenPx > 0, claimedWeight = 0 and displacementPx > 0 (the unclaimed-block observation)',
        values: {
          block: PROMO_BLOCK,
          firstScreenPx: 580,
          claimedWeight: 0,
          displacementPx: 95,
          movedBelow: 'path:/html/body/main/section[2]',
        },
      },
    ]);
    expect(demote.edits).toEqual([
      {
        op: 'move',
        subject: ['app.promo.p1', 'app.promo.p2', 'app.promo.price'],
        below: ['app.help.p'],
      },
    ]);
    const value = predicted(demote);
    expect(value.reflow).toBe('column-shift@1');
    expect(value.assumptions).toEqual(['single-column', 'no-rewrap']);
    // answeredAt[0] goes from 0 to 0.625 exactly: a point interval reads as its number.
    expect(delta(demote, 'role.answeredAt.0')).toBe(0.625);
    expect(delta(demote, 'ask.first.scrollPx[ask=B2,kind=reference]')).toBe(-610);
    expect(delta(demote, 'role.unclaimedBlocks')).toBe(-1);
    // The price (11 px) is the smallest value text, wherever it moves.
    expect(value.bounds.fontPx).toMatchObject({ min: 11, p10: 11 });
    expect(demote.costs[0].costs).toMatchObject({ roles: [], asks: [], interactionsAdded: 0 });
    // The demote and the order move the same block; the demote's anchor is the
    // help paragraph, which the disclose collapses.
    expect(demote.conflicts).toEqual([
      `order:${PROMO_BLOCK}>${ORDERS_BLOCK}`,
      'disclose:path:/html/body/main/section[2]',
    ]);
  });

  it('proposals are unranked unless the caller names orderedBy', () => {
    const capture = planPageCapture({ promoY: 100, ordersY: 710, helpY: 1510 });
    const report = planDensity([capture], {
      producer: DENSITY_TEST_PRODUCER,
      targets: planTargets(),
      floors: PLAN_FLOORS,
      evaluatedAt: AT,
    });
    expect(report.orderedBy).toBeNull();
    const ordered = plan([capture], planTargets(), {
      orderedBy: {
        quantity: 'ask.first.scrollPx[ask=B2,kind=reference]',
        direction: 'ascending',
        cell: 0,
      },
    });
    // -610, -17.25, 0 (the order leaves B2 where it was), +24.
    expect(ordered.map((p) => p.id)).toEqual([
      `demote:${PROMO_BLOCK}`,
      'pitch:repeat:app.orders.row1',
      `order:${PROMO_BLOCK}>${ORDERS_BLOCK}`,
      'disclose:path:/html/body/main/section[2]',
    ]);
  });

  it('each generator fires on its trigger', () => {
    const kitchen = plan(
      [planCapture(kitchenElements(), { targets: planTargets() })],
      planTargets()
    );
    expect(byId(kitchen, 'chrome:app.nav.link1').edits).toEqual([
      {
        op: 'collapse',
        subject: ['app.nav.link1', 'app.nav.link2', 'app.nav.link3', 'app.nav.link4'],
        summaryPx: 32,
        toggle: 'density-plan:chrome:app.nav.link1:toggle',
        container: 'density-plan:chrome:app.nav.link1:content',
      },
    ]);
    expect(byId(kitchen, 'dedupe:app.content.link').edits).toEqual([
      { op: 'remove', subject: ['app.content.link'] },
    ]);
    expect(byId(kitchen, 'one-line:repeat:app.rows.row1').edits).toEqual(
      [1, 2, 3].map((k) => ({ op: 'line-up', row: [`app.rows.row${k}`], gapPx: 8 }))
    );
    expect(
      delta(
        byId(kitchen, 'one-line:repeat:app.rows.row1'),
        'repeat.linesPerRow[repeat=repeat:app.rows.row1]'
      )
    ).toBe(-1);

    const targets = planTargets([
      { id: 'B5', rank: 5, weight: 1, kind: 'lookup', answer: { ids: ['app.list.row20'] } },
    ]);
    const long = planCapture(listPageElements({ rows: 30, pitch: 48, helpY: 1700 }), { targets });
    const find = byId(plan([long], targets), 'find:repeat:app.list.row1');
    expect(find.edits).toEqual([
      {
        op: 'insert',
        id: 'density-plan:find:repeat:app.list.row1:finder',
        role: 'searchbox',
        above: ['app.list.row1'],
        widthPx: 600,
        heightPx: 24,
      },
    ]);
    expect(find.evidence[0].values).toMatchObject({ ask: 'B5', filteredStateModelled: false });
    expect(delta(find, 'ask.first.scrollPx[ask=B5,kind=lookup]')).toBe(24);
  });

  it('pitch takes each row from its own pitch to the target, and leaves a row already under it', () => {
    const tops = [140, 188, 220, 268, 316];
    const els = listPageElements({ rows: 5, pitch: 48, helpY: 400 }).map((e) => {
      const m = /^app\.list\.row(\d)$/.exec(e.id);
      return m
        ? { ...e, rect: [16, tops[Number(m[1]) - 1], 600, 20] as [number, number, number, number] }
        : e;
    });
    const p = byId(plan([planCapture(els)], planTargets()), 'pitch:repeat:app.list.row1');
    // Own pitches 48, 32, 48, 48 and the last row's median 48, to the 28 px target.
    expect(p.edits).toEqual([
      { op: 'resize', subject: ['app.list.row1'], deltaPx: -20 },
      { op: 'resize', subject: ['app.list.row2'], deltaPx: -4 },
      { op: 'resize', subject: ['app.list.row3'], deltaPx: -20 },
      { op: 'resize', subject: ['app.list.row4'], deltaPx: -20 },
      { op: 'resize', subject: ['app.list.row5'], deltaPx: -20 },
    ]);
  });

  it('an orderedBy quantity the cell does not report is refused, never ordered as zero', () => {
    const capture = planPageCapture({ promoY: 100, ordersY: 710, helpY: 1510 });
    expect(() =>
      plan([capture], planTargets(), {
        orderedBy: { quantity: 'answeredAt[9]', direction: 'descending', cell: 0 },
      })
    ).toThrow(DensityPlanError);
  });

  it('an ask whose reach is unknown on both sides is a cost unknown, never a cost of zero', () => {
    // B5's answer has no rect: its scroll is unknown before and after any edit.
    const targets = planTargets([
      { id: 'B5', rank: 5, weight: 1, kind: 'lookup', answer: { ids: ['app.nowhere'] } },
    ]);
    const capture = planPageCapture(
      {
        promoY: 100,
        ordersY: 710,
        helpY: 1510,
        extra: [
          {
            id: 'app.nowhere',
            tag: 'span',
            xpath: '/html/body/main/section[3]/span',
            rect: null,
            text: 'x',
          },
        ],
      },
      targets
    );
    const demote = byId(plan([capture], targets), `demote:${PROMO_BLOCK}`);
    expect(demote.costs[0].costs!.unknownAsks).toEqual(['B5']);
  });

  it('a one-line that cannot fit is unknown{no_expectation} without floors, and says why with them', () => {
    const els = kitchenElements().map((e) =>
      /^app.rows.value/.test(e.id) && e.rect
        ? { ...e, rect: [e.rect[0], e.rect[1], 450, e.rect[3]] as [number, number, number, number] }
        : e
    );
    const capture = planCapture(els, { targets: planTargets() });
    const code = (floors: typeof PLAN_FLOORS | null) => {
      const o = byId(plan([capture], planTargets(), { floors }), 'one-line:repeat:app.rows.row1')
        .predicted[0].observation;
      return o.status === 'unknown' ? o.unknown.code : o.status;
    };
    expect(code(null)).toBe('no_expectation');
    expect(code(PLAN_FLOORS)).toBe('not_attempted_by_policy');
  });
});
