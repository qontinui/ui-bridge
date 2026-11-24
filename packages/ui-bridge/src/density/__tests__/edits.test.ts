// @vitest-environment node
/**
 * Design test 3: `applyDensityEdits` followed by `measureDensity` equals
 * `measureDensity` of a hand-built after-capture, in one column, for a demote,
 * a collapse and a pitch change; and the reflow declines where columns would
 * rebalance.
 *
 * Every after-capture here is built by hand with literal positions: through
 * the snapshot adapter where the edit adds no item (the demote, the pitch), and
 * item by item where it adds a toggle (the collapse). The comparison is of the
 * whole report, so an edit that moves one item wrongly reddens it.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 7).
 */
import { describe, expect, it } from 'vitest';
import { applyDensityEdits, type DensityEdit } from '../edits';
import { measureDensity, type DensityMeasureReport } from '../measure';
import type { DensityCapture, DensityItem } from '../schema';
import { DENSITY_TEST_PRODUCER, type DensityTestElementSpec } from './fixtures/snapshot-builder';
import {
  PLAN_FLOORS,
  listPageElements,
  planCapture,
  planPageCapture,
  planPageElements,
  planTargets,
} from './fixtures/plan-page';

function report(capture: DensityCapture, targets = planTargets()): DensityMeasureReport {
  const obs = measureDensity(capture, {
    producer: DENSITY_TEST_PRODUCER,
    targets,
    floors: PLAN_FLOORS,
    evaluatedAt: '2026-11-24T10:00:00.000Z',
  });
  if (obs.status !== 'measured') throw new Error(`expected measured, got ${JSON.stringify(obs)}`);
  return obs.value;
}

function applied(capture: DensityCapture, edits: DensityEdit[]): DensityCapture {
  const r = applyDensityEdits(capture, edits);
  if (!r.ok) throw new Error(`expected the edits to apply: ${JSON.stringify(r)}`);
  return r.capture;
}

const PROMO = ['app.promo.p1', 'app.promo.p2', 'app.promo.price'];
const ROWS = ['app.orders.row1', 'app.orders.row2', 'app.orders.row3'];

function itemOf(c: DensityCapture, id: string): DensityItem {
  const item = c.items.find((i) => i.id === id);
  if (!item) throw new Error(`no item ${id}`);
  return item;
}

describe('applyDensityEdits then measureDensity equals measureDensity of a hand-built after-capture', () => {
  it('a demote: the promo moves below the help section', () => {
    const before = planPageCapture({ promoY: 100, ordersY: 710, helpY: 1510 });
    const after = applied(before, [{ op: 'move', subject: PROMO, below: ['app.help.p'] }]);
    // By hand: the promo's pitch (610 px) closes up, so the orders section
    // starts at 100 and the help paragraph at 900; the promo goes under the
    // help paragraph with its own 20 px trailing gap, at 960.
    const hand = planPageCapture({ promoY: 960, ordersY: 100, helpY: 900 });
    expect(after).toEqual(hand);
    expect(report(after)).toEqual(report(hand));
    // The literal twin of the moved geometry.
    expect(itemOf(after, 'app.promo.price').rect).toEqual({ x: 16, y: 1530, w: 600, h: 20 });
    expect(itemOf(after, 'app.help.p').rect).toEqual({ x: 16, y: 900, w: 200, h: 40 });
    expect(report(after).role!.answeredAt[0]).toEqual({ k: 0, lo: 0.625, hi: 0.625 });
  });

  it('a collapse: the promo goes behind a one-line summary row', () => {
    const targets = planTargets([
      { id: 'B4', rank: 4, weight: 1, kind: 'reference', answer: { ids: ['app.promo.price'] } },
    ]);
    const before = planPageCapture({ promoY: 240, ordersY: 100, helpY: 900 }, targets);
    const after = applied(before, [
      {
        op: 'collapse',
        subject: PROMO,
        summaryPx: 24,
        toggle: 'edit.toggle',
        container: 'edit.body',
      },
    ]);

    // By hand: a 24 px summary row replaces the 590 px promo, so the help
    // paragraph rises by 566 px; the promo is hidden under the summary row,
    // inside a container the toggle controls.
    const p1 = itemOf(before, 'app.promo.p1');
    const hand: DensityCapture = {
      ...before,
      viewport: { ...before.viewport, documentHeight: 1834 },
      items: [],
    };
    for (const item of before.items) {
      if (item.id === 'app.promo.p1') {
        hand.items.push(
          {
            ...item,
            id: 'edit.toggle',
            parent: null,
            tag: 'button',
            role: 'button',
            interactive: true,
            authorId: false,
            rect: { x: 16, y: 240, w: 600, h: 24 },
            visibility: 'rendered',
            chars: 0,
            ownChars: 0,
            charsDrawn: true,
            siblingKey: null,
            cousinKey: null,
            cousinRowKey: null,
            textHash: null,
            shape: null,
            fontPx: null,
            lineHeightPx: null,
            position: 'static',
            truncated: false,
            recoverable: null,
            expanded: false,
            controls: 'edit.body',
            selected: null,
            filters: null,
            href: null,
          },
          {
            ...item,
            id: 'edit.body',
            parent: null,
            tag: 'div',
            role: null,
            interactive: false,
            authorId: false,
            rect: { x: 16, y: 264, w: 600, h: 590 },
            visibility: 'hidden',
            chars: 0,
            ownChars: 0,
            charsDrawn: null,
            blockKey: null,
            siblingKey: null,
            cousinKey: null,
            cousinRowKey: null,
            textHash: null,
            shape: null,
            fontPx: null,
            lineHeightPx: null,
            position: 'static',
            truncated: false,
            recoverable: null,
            expanded: null,
            controls: null,
            selected: null,
            filters: null,
            href: null,
          }
        );
      }
      const y: Record<string, number> = {
        'app.promo.p1': 264,
        'app.promo.p2': 564,
        'app.promo.price': 834,
        'app.help.p': 334,
      };
      const moved = y[item.id] !== undefined ? { ...item.rect!, y: y[item.id] } : item.rect;
      hand.items.push(
        PROMO.includes(item.id)
          ? { ...item, rect: moved, visibility: 'hidden', parent: 'edit.body' }
          : { ...item, rect: moved }
      );
    }
    expect(p1.path).toEqual(['html', 'body', 'main', 'article']);
    expect(after).toEqual(hand);
    expect(report(after, targets)).toEqual(report(hand, targets));

    // The literal twin: the ask inside gains the one interaction of opening it.
    const ask = (r: DensityMeasureReport, id: string) => r.role!.asks.find((a) => a.id === id)!;
    expect(ask(report(before, targets), 'B4').first!.interactions).toBe(0);
    expect(ask(report(after, targets), 'B4').first!.interactions).toBe(1);
    expect(ask(report(after, targets), 'B2').first!.scrollPx).toBe(0);
  });

  it('a pitch change: every row of the list takes a 28 px pitch', () => {
    const before = planCapture(listPageElements({ rows: 5, pitch: 48, helpY: 400 }));
    const rows = [1, 2, 3, 4, 5].map((k) => [`app.list.row${k}`]);
    const after = applied(
      before,
      rows.map((row) => ({ op: 'resize', subject: row, deltaPx: -20 }))
    );
    // By hand: rows at 140, 168, 196, 224, 252; everything under the list rises by 5 × 20 px.
    const hand = planCapture(listPageElements({ rows: 5, pitch: 28, helpY: 300 }), {
      documentHeight: 2300,
    });
    expect(after).toEqual(hand);
    expect(report(after, planTargets())).toEqual(report(hand, planTargets()));
    expect(itemOf(after, 'app.list.row5').rect!.y).toBe(252);
  });
});

describe('column-shift@1 declines what it cannot predict', () => {
  it('a two-column capture where the edit would rebalance columns answers unknown', () => {
    const before = planCapture(
      planPageElements({
        promoY: 100,
        ordersY: 710,
        helpY: 1510,
        extra: [
          {
            id: 'app.side.p',
            tag: 'p',
            xpath: '/html/body/main/aside/p',
            rect: [700, 100, 300, 400],
            text: 'Synthetic aside',
          },
          {
            id: 'app.wide.p',
            tag: 'p',
            xpath: '/html/body/section/p',
            rect: [0, 1700, 1280, 100],
            text: 'Synthetic wide band',
          },
        ],
      }),
      { targets: planTargets() }
    );
    const r = applyDensityEdits(before, [
      {
        op: 'collapse',
        subject: PROMO,
        summaryPx: 24,
        toggle: 'edit.toggle',
        container: 'edit.body',
      },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.unknown).toBe('not_attempted_by_policy');
    expect(r.edit).toBe(0);
    expect(r.reason).toContain('columns rebalance');
    expect(r.reason).toContain('app.wide.p');
    expect(r.reason).toContain('app.side.p');
  });

  it('a pinned subject is declined, and an id the capture lacks is input_missing', () => {
    const before = planPageCapture({ promoY: 100, ordersY: 710, helpY: 1510 });
    const pinned = applyDensityEdits(before, [
      { op: 'resize', subject: ['app.header'], deltaPx: -10 },
    ]);
    expect(pinned).toMatchObject({ ok: false, unknown: 'not_attempted_by_policy' });
    const missing = applyDensityEdits(before, [{ op: 'remove', subject: ['app.nothing'] }]);
    expect(missing).toMatchObject({ ok: false, unknown: 'input_missing', edit: 0 });
  });

  it('does not change the capture it is given', () => {
    const before = planPageCapture({ promoY: 100, ordersY: 710, helpY: 1510 });
    const copy = structuredClone(before);
    applied(before, [{ op: 'move', subject: PROMO, below: ROWS }]);
    expect(before).toEqual(copy);
  });
});

describe('column-shift@1 on containers, sidebars and insertion points', () => {
  const els = (o: { sectionY?: number; aside?: boolean } = {}): DensityTestElementSpec[] => [
    {
      id: 'app.sec',
      tag: 'section',
      xpath: '/html/body/main/section',
      rect: [16, o.sectionY ?? 100, 600, 400 - (o.sectionY ?? 100)],
    },
    {
      id: 'app.sec.p1',
      tag: 'p',
      xpath: '/html/body/main/section/p[1]',
      rect: [16, 110, 600, 100],
      text: 'One',
    },
    {
      id: 'app.sec.p2',
      tag: 'p',
      xpath: '/html/body/main/section/p[2]',
      rect: [16, 220, 600, 100],
      text: 'Two',
    },
    { id: 'app.foot', tag: 'p', xpath: '/html/body/div/p', rect: [16, 420, 600, 40], text: 'Foot' },
    ...(o.aside
      ? [
          {
            id: 'app.side',
            tag: 'p',
            xpath: '/html/body/aside/p',
            rect: [700, 0, 300, 1000] as [number, number, number, number],
            text: 'Side',
          },
        ]
      : []),
  ];
  const rectOf = (c: DensityCapture, id: string) => itemOf(c, id).rect;

  it("removing a container's last item frees its height and the gap above it, not the container's padding", () => {
    const after = applied(planCapture(els()), [{ op: 'remove', subject: ['app.sec.p2'] }]);
    expect(rectOf(after, 'app.foot')).toEqual({ x: 16, y: 310, w: 600, h: 40 });
    expect(rectOf(after, 'app.sec')).toEqual({ x: 16, y: 100, w: 600, h: 190 });
    expect(rectOf(after, 'app.sec.p1')).toEqual({ x: 16, y: 110, w: 600, h: 100 });
    // The document follows its lowest item, 110 px higher.
    expect(after.viewport.documentHeight).toBe(2290);
  });

  it('a sidebar neither holds a removed band nor lets a main-column shift cut the document', () => {
    const after = applied(planCapture(els({ aside: true })), [
      { op: 'remove', subject: ['app.sec.p2'] },
    ]);
    expect(rectOf(after, 'app.foot')).toEqual({ x: 16, y: 310, w: 600, h: 40 });
    // The sidebar still reaches 1000: the document keeps its height.
    expect(after.viewport.documentHeight).toBe(2400);
  });

  it('an insertion at a container top grows the container and lands inside it', () => {
    const after = applied(planCapture(els({ sectionY: 110 })), [
      {
        op: 'insert',
        id: 'edit.find',
        role: 'searchbox',
        above: ['app.sec.p1'],
        widthPx: 600,
        heightPx: 24,
      },
    ]);
    expect(rectOf(after, 'app.sec')).toEqual({ x: 16, y: 110, w: 600, h: 314 });
    expect(rectOf(after, 'edit.find')).toEqual({ x: 16, y: 110, w: 600, h: 24 });
    expect(itemOf(after, 'edit.find').parent).toBe('app.sec');
    expect(rectOf(after, 'app.sec.p1')).toEqual({ x: 16, y: 134, w: 600, h: 100 });
  });

  it('a moved block takes the parent of the item it is moved below', () => {
    const after = applied(planCapture(els()), [
      { op: 'move', subject: ['app.foot'], below: ['app.sec.p1'] },
    ]);
    expect(itemOf(after, 'app.foot').parent).toBe('app.sec');
    expect(rectOf(after, 'app.foot')).toEqual({ x: 16, y: 220, w: 600, h: 40 });
    // Nothing follows the footer, so it frees (and takes) its own 40 px.
    expect(rectOf(after, 'app.sec.p2')).toEqual({ x: 16, y: 260, w: 600, h: 100 });
    expect(rectOf(after, 'app.sec')).toEqual({ x: 16, y: 100, w: 600, h: 340 });
  });

  it('a block moved to the end of an unpadded container grows the container to hold it', () => {
    const after = applied(
      planCapture(
        els({ sectionY: 110 }).map((e) =>
          e.id === 'app.sec'
            ? { ...e, rect: [16, 110, 600, 210] as [number, number, number, number] }
            : e
        )
      ),
      [{ op: 'move', subject: ['app.sec.p1'], below: ['app.sec.p2'] }]
    );
    expect(rectOf(after, 'app.sec.p2')).toEqual({ x: 16, y: 110, w: 600, h: 100 });
    expect(rectOf(after, 'app.sec.p1')).toEqual({ x: 16, y: 220, w: 600, h: 100 });
    expect(rectOf(after, 'app.sec')).toEqual({ x: 16, y: 110, w: 600, h: 210 });
  });

  it('content past the document end (an inner scroller) does not size the document', () => {
    const rows: DensityTestElementSpec[] = [1, 2].map((k) => ({
      id: `app.scroll.r${k}`,
      tag: 'p',
      xpath: `/html/body/main/div/p[${k}]`,
      rect: [16, 850 + 110 * (k - 1), 600, 100] as [number, number, number, number],
      text: `Row ${k}`,
    }));
    const before = planCapture([...els(), ...rows], { documentHeight: 800 });
    const after = applied(before, [{ op: 'remove', subject: ['app.scroll.r1'] }]);
    expect(after.viewport.documentHeight).toBe(800);
  });

  it('an edit that grows a page whose last item ends at the document bottom grows the document', () => {
    const before = planCapture(els(), { documentHeight: 460 });
    const after = applied(before, [
      {
        op: 'insert',
        id: 'edit.find',
        role: 'searchbox',
        above: ['app.sec.p1'],
        widthPx: 600,
        heightPx: 40,
      },
    ]);
    expect(after.viewport.documentHeight).toBe(500);
  });
});
