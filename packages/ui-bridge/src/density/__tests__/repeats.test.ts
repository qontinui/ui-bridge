// @vitest-environment node
/**
 * repeats.ts over hand-built snapshots (design test 1, continued): literal
 * expected repeats and row quantities.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 4).
 */
import { describe, expect, it } from 'vitest';
import { captureDensityFromSnapshot } from '../capture-from-snapshot';
import { densityRepeats, summarizeDensityRepeats } from '../repeats';
import { parseDensityCapture, parseDensityTargets, type DensityCapture } from '../schema';
import {
  DENSITY_TEST_PRODUCER,
  densityTestSnapshot,
  type DensityTestElementSpec,
} from './fixtures/snapshot-builder';

function capture(elements: DensityTestElementSpec[]): DensityCapture {
  const obs = captureDensityFromSnapshot(densityTestSnapshot({ elements }), {
    producer: DENSITY_TEST_PRODUCER,
    evaluatedAt: '2026-11-23T10:00:00.000Z',
  });
  if (obs.status !== 'measured') throw new Error(`expected measured, got ${JSON.stringify(obs)}`);
  return obs.value;
}

const SECTION = '/html/body/main/section';
const UL = `${SECTION}/ul`;

/** A section holding a heading and a list of `rows` rows 40 px apart, each with an id and an amount. */
function orderList(rows: number): DensityTestElementSpec[] {
  const out: DensityTestElementSpec[] = [
    {
      id: 'app.orders',
      tag: 'section',
      xpath: SECTION,
      rect: [0, 100, 600, 400],
      text: 'Open orders',
    },
    {
      id: 'app.orders.title',
      tag: 'h2',
      xpath: `${SECTION}/h2`,
      rect: [0, 100, 600, 28],
      text: 'Open orders',
    },
    { id: 'app.orders.list', tag: 'ul', xpath: UL, rect: [0, 140, 600, 40 * rows], text: '' },
  ];
  for (let k = 1; k <= rows; k++) {
    const y = 140 + 40 * (k - 1);
    const no = `A-100${k}`;
    out.push(
      {
        id: `app.orders.row-${k}`,
        tag: 'li',
        xpath: `${UL}/li[${k}]`,
        rect: [0, y, 600, 36],
        text: `${no} 12,50 €`,
      },
      {
        id: `app.orders.row-${k}.no`,
        tag: 'span',
        xpath: `${UL}/li[${k}]/span[1]`,
        rect: [0, y, 200, 20],
        text: no,
      },
      {
        id: `app.orders.row-${k}.sum`,
        tag: 'span',
        xpath: `${UL}/li[${k}]/span[2]`,
        rect: [300, y, 100, 20],
        text: '12,50 €',
      }
    );
  }
  return out;
}

/** Three cards whose xpaths name no ancestor, inside a container, at the given left edges and widths. */
function cards(edges: Array<[number, number]>): DensityTestElementSpec[] {
  return [
    {
      id: 'app.cards',
      tag: 'div',
      xpath: '//*[@id="cards"]',
      htmlId: 'cards',
      rect: [80, 100, 500, 400],
      text: '',
    },
    ...edges.map(
      ([x, w], i): DensityTestElementSpec => ({
        id: `app.cards.card-${i + 1}`,
        tag: 'div',
        xpath: `//*[@id="card-${i + 1}"]`,
        htmlId: `card-${i + 1}`,
        rect: [x, 110 + 60 * i, w, 50],
        text: '',
      })
    ),
  ];
}

describe('repeats', () => {
  it('runs with no DOM', () => {
    expect(typeof document).toBe('undefined');
  });

  it('a five-row list is one repeat by path, with its row quantities', () => {
    const c = capture(orderList(5));
    expect(densityRepeats(c, null, { volume: 50 })).toEqual([
      {
        id: 'repeat:app.orders.row-1',
        by: 'path',
        parent: 'app.orders.list',
        tag: 'li',
        members: [
          'app.orders.row-1',
          'app.orders.row-2',
          'app.orders.row-3',
          'app.orders.row-4',
          'app.orders.row-5',
        ],
        rows: 5,
        perRow: 1,
        firstRow: { topPx: 140, bottomPx: 176 },
        lastRow: { topPx: 300, bottomPx: 336 },
        rowPitchPx: 40,
        linesBasis: 'estimated',
        // Both spans of a row fit one line at the same top: one band of 20 px.
        linesPerRow: 1,
        rowTextPx: 20,
        rowFill: 0.5,
        rowsEstimated: 5,
        // The id is an identifier and the amount a currency: two values by shape.
        valuesPerRow: 2,
        // [0, 200) and [300, 400) of [0, 600).
        widthFill: 0.5,
        rowsPerScreen: 20,
        rowsPerScreenBasis: 'measured',
        extentPx: 196,
        extentAtVolume: { volume: 50, px: 1996 },
        // No control outside the list in its block or a near ancestor.
        scope: null,
        finder: null,
        renderedOf: {
          unknown: 'input_missing',
          reason:
            'a snapshot carries only the rows that are registered; how many exist is measured by the document walk',
        },
      },
    ]);
  });

  it('with no declared volume the projected extent is unknown{no_expectation}', () => {
    const [rep] = densityRepeats(capture(orderList(3)), null);
    expect(rep.rows).toBe(3);
    expect(rep.extentAtVolume).toEqual({
      unknown: 'no_expectation',
      reason: 'no row volume was declared (the budget names the rows each list is judged at)',
    });
  });

  it('a two-row group is not a repeat', () => {
    expect(densityRepeats(capture(orderList(2)), null)).toEqual([]);
  });

  it('siblings side by side in one row are not a repeat', () => {
    const strip: DensityTestElementSpec[] = [
      { id: 'app.tabs', tag: 'div', xpath: '/html/body/div', rect: [0, 0, 600, 40], text: '' },
      ...[1, 2, 3, 4].map(
        (k): DensityTestElementSpec => ({
          id: `app.tabs.tab-${k}`,
          tag: 'button',
          category: 'interactive',
          xpath: `/html/body/div/button[${k}]`,
          rect: [100 * (k - 1), 0, 90, 40],
          text: `Tab ${k}`,
        })
      ),
    ];
    expect(densityRepeats(capture(strip), null)).toEqual([]);
  });

  it('a geometry-only repeat whose edges differ by 2 px is one repeat', () => {
    const c = capture(
      cards([
        [100, 300],
        [102, 300],
        [101, 302],
      ])
    );
    const reps = densityRepeats(c, null);
    expect(reps.map((r) => [r.id, r.by, r.parent, r.rows, r.rowPitchPx, r.extentPx])).toEqual([
      ['repeat:app.cards.card-1', 'geometry', 'app.cards', 3, 60, 170],
    ]);
    expect(reps[0].members).toEqual(['app.cards.card-1', 'app.cards.card-2', 'app.cards.card-3']);
    // Rows with no text: zero line bands, still estimated.
    expect([reps[0].linesPerRow, reps[0].rowTextPx, reps[0].rowFill]).toEqual([0, 0, 0]);
  });

  it('a geometry group whose edges differ by 3 px is not a repeat', () => {
    expect(
      densityRepeats(
        capture(
          cards([
            [100, 300],
            [103, 300],
            [100, 300],
          ])
        ),
        null
      )
    ).toEqual([]);
    expect(
      densityRepeats(
        capture(
          cards([
            [100, 300],
            [100, 303],
            [100, 300],
          ])
        ),
        null
      )
    ).toEqual([]);
  });

  it('a row whose text leaf has no line height is not estimated', () => {
    const els = orderList(3).map((e) =>
      e.id === 'app.orders.row-2.no' ? { ...e, styles: { lineHeight: 'normal' } } : e
    );
    const [rep] = densityRepeats(capture(els), null);
    expect([rep.rowsEstimated, rep.linesPerRow, rep.rowTextPx]).toEqual([2, 1, 20]);
  });

  it('a long label wraps in the estimate: 40 characters at 14 px over 100 px is 3 lines', () => {
    const els = orderList(3).map((e) =>
      e.id.endsWith('.sum')
        ? {
            ...e,
            text: 'x'.repeat(40),
            rect: [300, e.rect![1], 100, 60] as [number, number, number, number],
          }
        : e
    );
    const [rep] = densityRepeats(capture(els), null);
    // The id's line shares the first band; the label adds two more.
    expect([rep.linesPerRow, rep.rowTextPx, rep.rowFill]).toEqual([3, 60, 1.5]);
  });

  it('hidden members take no space and are left out', () => {
    const els = orderList(3).map((e) =>
      e.id === 'app.orders.row-3'
        ? { ...e, visible: false, visibilityReason: 'hidden' as const }
        : e
    );
    expect(densityRepeats(capture(els), null)).toEqual([]);
  });

  it('a row holding a redacted leaf is not estimated, never zero', () => {
    const els = orderList(3).map((e) =>
      e.id === 'app.orders.row-2.sum' ? { ...e, redacted: true } : e
    );
    const [rep] = densityRepeats(capture(els), null);
    expect([rep.rows, rep.rowsEstimated, rep.linesPerRow, rep.valuesPerRow]).toEqual([3, 2, 1, 2]);
    // Every row redacted: the quantities are unknown (null), not zero.
    const all = orderList(3).map((e) => (e.id.endsWith('.sum') ? { ...e, redacted: true } : e));
    const [none] = densityRepeats(capture(all), null);
    expect([
      none.rowsEstimated,
      none.linesPerRow,
      none.rowTextPx,
      none.rowFill,
      none.valuesPerRow,
      none.widthFill,
    ]).toEqual([0, null, null, null, null, null]);
  });

  it('three stacked siblings of different widths are not a repeat, nor is a run of paragraphs', () => {
    // Layout wrappers: containers (each holds a registered child) of different widths.
    const wrappers: DensityTestElementSpec[] = (
      [
        ['a', 60, 1280, 0],
        ['b', 600, 900, 60],
        ['c', 80, 400, 660],
      ] as const
    ).flatMap(([n, h, w, y], i): DensityTestElementSpec[] => [
      {
        id: `app.${n}`,
        tag: 'div',
        xpath: `/html/body/div[${i + 1}]`,
        rect: [0, y, w, h],
        text: 'X',
      },
      {
        id: `app.${n}.x`,
        tag: 'span',
        xpath: `/html/body/div[${i + 1}]/span`,
        rect: [0, y, 20, 20],
        text: 'X',
      },
    ]);
    expect(densityRepeats(capture(wrappers), null)).toEqual([]);
    const prose: DensityTestElementSpec[] = [1, 2, 3].map((k) => ({
      id: `app.p-${k}`,
      tag: 'p',
      xpath: `/html/body/article/p[${k}]`,
      rect: [0, 100 * k, 600, 80],
      text: `Synthetic paragraph ${k}`,
    }));
    expect(densityRepeats(capture(prose), null)).toEqual([]);
  });

  it('a geometry grid of two columns and three rows is one repeat, two per row', () => {
    const grid: DensityTestElementSpec[] = [
      {
        id: 'app.grid',
        tag: 'div',
        xpath: '//*[@id="grid"]',
        rect: [0, 100, 700, 400],
        text: '',
      },
    ];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 2; col++) {
        const n = row * 2 + col + 1;
        grid.push({
          id: `app.grid.card-${n}`,
          tag: 'div',
          xpath: `//*[@id="card-${n}"]`,
          rect: [20 + 320 * col, 110 + 100 * row, 300, 80],
          text: '',
        });
      }
    }
    const reps = densityRepeats(capture(grid), null);
    expect(reps.map((r) => [r.id, r.by, r.rows, r.perRow, r.members.length, r.rowPitchPx])).toEqual(
      [['repeat:app.grid.card-1', 'geometry', 3, 2, 6, 100]]
    );
  });

  it('a fit-content list of leaves of different widths is a repeat', () => {
    const links: DensityTestElementSpec[] = [80, 140, 60].map((w, i) => ({
      id: `app.nav.link-${i + 1}`,
      tag: 'a',
      xpath: `/html/body/aside/a[${i + 1}]`,
      rect: [16, 100 + 28 * i, w, 20],
      text: `Link ${i + 1}`,
    }));
    const reps = densityRepeats(capture(links), null);
    expect(reps.map((r) => [r.id, r.by, r.rows])).toEqual([['repeat:app.nav.link-1', 'path', 3]]);
  });

  it('items under different parents with one tag chain are not siblings', () => {
    // body/div[2]/button, body/div[4]/button, body/div[6]/button: no registered parent.
    const buttons: DensityTestElementSpec[] = [2, 4, 6].map((k) => ({
      id: `app.btn-${k}`,
      tag: 'button',
      category: 'interactive',
      xpath: `/html/body/div[${k}]/button`,
      rect: [0, 100 * k, 120, 32],
      text: `Go ${k}`,
    }));
    expect(densityRepeats(capture(buttons), null)).toEqual([]);
  });

  it('a ragged geometry grid keeps its short columns: seven cards in three columns', () => {
    const grid: DensityTestElementSpec[] = [
      { id: 'app.grid', tag: 'div', xpath: '//*[@id="grid"]', rect: [0, 100, 1000, 400], text: '' },
    ];
    for (let n = 0; n < 7; n++) {
      const row = Math.floor(n / 3);
      const col = n % 3;
      grid.push({
        id: `app.grid.card-${n + 1}`,
        tag: 'div',
        xpath: `//*[@id="card-${n + 1}"]`,
        rect: [20 + 320 * col, 110 + 100 * row, 300, 80],
        text: '',
      });
    }
    const reps = densityRepeats(capture(grid), null);
    expect(reps.map((r) => [r.rows, r.perRow, r.members.length])).toEqual([[3, 3, 7]]);
  });

  it('a row holding a leaf with no rect is not estimated', () => {
    const els = orderList(3).map((e) =>
      e.id === 'app.orders.row-2.sum' ? { ...e, rect: null } : e
    );
    const [rep] = densityRepeats(capture(els), null);
    expect([rep.rows, rep.rowsEstimated, rep.valuesPerRow]).toEqual([3, 2, 2]);
  });

  it('a CSS grid of sibling cards is one repeat, three per row', () => {
    const cardsEls: DensityTestElementSpec[] = [
      { id: 'app.cards', tag: 'ul', xpath: '/html/body/ul', rect: [0, 100, 1000, 400], text: '' },
    ];
    for (let n = 0; n < 12; n++) {
      cardsEls.push({
        id: `app.cards.card-${n + 1}`,
        tag: 'li',
        xpath: `/html/body/ul/li[${n + 1}]`,
        rect: [20 + 320 * (n % 3), 110 + 90 * Math.floor(n / 3), 300, 80],
        text: '',
      });
    }
    const reps = densityRepeats(capture(cardsEls), null);
    expect(reps.map((r) => [r.by, r.rows, r.perRow, r.members.length])).toEqual([
      ['path', 4, 3, 12],
    ]);
  });

  it('links inside list items nobody registered are one repeat', () => {
    const links: DensityTestElementSpec[] = [1, 2, 3, 4].map((k) => ({
      id: `app.nav.link-${k}`,
      tag: 'a',
      xpath: `/html/body/nav/ul/li[${k}]/a`,
      rect: [16, 100 + 28 * (k - 1), 120, 20],
      text: `Link ${k}`,
    }));
    const reps = densityRepeats(capture(links), null);
    expect(reps.map((r) => [r.id, r.by, r.rows])).toEqual([['repeat:app.nav.link-1', 'path', 4]]);
  });

  it('cells of table rows nobody registered are one repeat, two per row', () => {
    const cells: DensityTestElementSpec[] = [];
    for (let k = 1; k <= 3; k++) {
      for (let j = 1; j <= 2; j++) {
        cells.push({
          id: `app.t.r${k}c${j}`,
          tag: 'td',
          xpath: `/html/body/table/tbody/tr[${k}]/td[${j}]`,
          rect: [400 * (j - 1), 100 + 40 * (k - 1), 400, 40],
          text: j === 1 ? `R${k}` : '12,50 €',
        });
      }
    }
    const reps = densityRepeats(capture(cells), null);
    expect(reps.map((r) => [r.rows, r.perRow, r.members.length, r.valuesPerRow])).toEqual([
      [3, 2, 6, 2],
    ]);
  });

  it('a truncated or nowrap cell is not estimated past its measured height', () => {
    const els = orderList(3).map((e) =>
      e.id.endsWith('.sum') ? { ...e, text: 'x'.repeat(40) } : e
    );
    // 40 characters at 14 px over 100 px would wrap to 3 lines; the cell is 20 px tall.
    const [rep] = densityRepeats(capture(els), null);
    expect([rep.linesPerRow, rep.rowTextPx, rep.rowFill]).toEqual([1, 20, 0.5]);
  });

  /** Six list rows 70 px apart, each a title, a subtitle and a date stacked. */
  function stackedRows(registerRows: boolean): DensityTestElementSpec[] {
    const out: DensityTestElementSpec[] = [];
    for (let k = 1; k <= 6; k++) {
      const y = 100 + 70 * (k - 1);
      if (registerRows) {
        out.push({
          id: `app.r${k}`,
          tag: 'li',
          xpath: `/html/body/ul/li[${k}]`,
          rect: [0, y, 400, 66],
          text: 'Title Sub 16.10.2026',
        });
      }
      (
        [
          ['t', 180, 'Title'],
          ['s', 120, 'Sub'],
          ['d', 60, '16.10.2026'],
        ] as const
      ).forEach(([n, w, text], j) =>
        out.push({
          id: `app.r${k}.${n}`,
          tag: 'span',
          xpath: `/html/body/ul/li[${k}]/span[${j + 1}]`,
          rect: [0, y + 22 * j, w, 20],
          text,
        })
      );
    }
    return out;
  }

  it('the lines stacked inside each row are not repeats of their own', () => {
    const reps = densityRepeats(capture(stackedRows(true)), null);
    expect(reps.map((r) => [r.id, r.rows, r.perRow])).toEqual([['repeat:app.r1', 6, 1]]);
    // Three line bands per row: 20 px each.
    expect([reps[0].linesPerRow, reps[0].rowTextPx]).toEqual([3, 60]);
  });

  it('stacked lines inside rows nobody registered are one repeat, counted in its rows', () => {
    const reps = densityRepeats(capture(stackedRows(false)), null);
    expect(reps.map((r) => [r.id, r.rows, r.perRow, r.members.length, r.rowPitchPx])).toEqual([
      // Three lines stacked in each item are one column.
      ['repeat:app.r1.t', 6, 1, 18, 70],
    ]);
  });

  it('a fit-content list stays one repeat when some of its items share a width', () => {
    const widths = [40, 62, 62, 62, 55, 71, 48, 80];
    const links: DensityTestElementSpec[] = widths.map((w, i) => ({
      id: `app.l${i + 1}`,
      tag: 'a',
      xpath: `/html/body/aside/a[${i + 1}]`,
      rect: [16, 100 + 24 * i, w, 20],
      text: `L${i + 1}`,
    }));
    const reps = densityRepeats(capture(links), null);
    expect(reps.map((r) => [r.id, r.rows, r.members.length])).toEqual([['repeat:app.l1', 8, 8]]);
  });

  it('a row whose container holds text of its own beside its children is not estimated', () => {
    const els = orderList(3).map((e) =>
      e.id === 'app.orders.row-2' ? { ...e, text: `${e.text} and an unregistered note` } : e
    );
    const [rep] = densityRepeats(capture(els), null);
    expect([rep.rows, rep.rowsEstimated]).toEqual([3, 2]);
  });

  it('links side by side in unregistered list items are one row, not a repeat', () => {
    const nav: DensityTestElementSpec[] = [1, 2, 3, 4, 5].map((k) => ({
      id: `app.top.${k}`,
      tag: 'a',
      xpath: `/html/body/header/nav/ul/li[${k}]/a`,
      rect: [100 * k, 10, 80, 20],
      text: `Top ${k}`,
    }));
    expect(densityRepeats(capture(nav), null)).toEqual([]);
  });

  it('a card grid in unregistered list items is one repeat, three per row', () => {
    const grid: DensityTestElementSpec[] = [];
    for (let n = 0; n < 9; n++) {
      grid.push({
        id: `app.g.${n + 1}`,
        tag: 'a',
        xpath: `/html/body/main/ul/li[${n + 1}]/a`,
        rect: [20 + 320 * (n % 3), 100 + 90 * Math.floor(n / 3), 300, 80],
        text: `Card ${n + 1}`,
      });
    }
    const reps = densityRepeats(capture(grid), null);
    expect(reps.map((r) => [r.rows, r.perRow, r.rowPitchPx, r.members.length])).toEqual([
      [3, 3, 90, 9],
    ]);
  });

  it('a link inside a card inside an unregistered list item makes no second repeat', () => {
    const els: DensityTestElementSpec[] = [];
    for (let k = 1; k <= 4; k++) {
      const y = 100 + 60 * (k - 1);
      els.push(
        {
          id: `app.card.${k}`,
          tag: 'div',
          xpath: `/html/body/ul/li[${k}]/div`,
          rect: [0, y, 400, 56],
          text: `Card ${k} Open`,
        },
        {
          id: `app.card.${k}.open`,
          tag: 'a',
          xpath: `/html/body/ul/li[${k}]/div/a`,
          rect: [300, y, 80, 20],
          text: 'Open',
        }
      );
    }
    const reps = densityRepeats(capture(els), null);
    // The cards are the rows' members; the links inside them are the cards' content.
    expect(reps.map((r) => [r.id, r.rows, r.perRow, r.members.length])).toEqual([
      ['repeat:app.card.1', 4, 1, 4],
    ]);
  });

  it('a card grid in each of three stacked sections is a repeat of its own', () => {
    const els: DensityTestElementSpec[] = [];
    for (let s = 1; s <= 3; s++) {
      const top = 100 + 400 * (s - 1);
      els.push({
        id: `app.cat.${s}`,
        tag: 'section',
        xpath: `/html/body/main/section[${s}]`,
        rect: [0, top, 1000, 380],
        text: '',
      });
      for (let n = 0; n < 9; n++) {
        els.push({
          id: `app.cat.${s}.card-${n + 1}`,
          tag: 'div',
          xpath: `/html/body/main/section[${s}]/div[${n + 1}]`,
          rect: [20 + 320 * (n % 3), top + 10 + 120 * Math.floor(n / 3), 300, 110],
          text: `Item ${n + 1}`,
        });
      }
    }
    const reps = densityRepeats(capture(els), null);
    expect(reps.map((r) => [r.id, r.rows, r.perRow])).toEqual([
      ['repeat:app.cat.1', 3, 1],
      ['repeat:app.cat.1.card-1', 3, 3],
      ['repeat:app.cat.2.card-1', 3, 3],
      ['repeat:app.cat.3.card-1', 3, 3],
    ]);
  });

  it('a run of paragraphs found by geometry is text, not rows', () => {
    const els: DensityTestElementSpec[] = [
      { id: 'app.body', tag: 'div', xpath: '//*[@id="body"]', rect: [0, 0, 800, 600], text: '' },
      ...[1, 2, 3].map(
        (k): DensityTestElementSpec => ({
          id: `app.p${k}`,
          tag: 'p',
          xpath: `//*[@id="p${k}"]`,
          rect: [20, 100 * k, 600, 80],
          text: `Synthetic paragraph ${k}`,
        })
      ),
    ];
    expect(densityRepeats(capture(els), null)).toEqual([]);
  });

  it('a table of unregistered rows whose cells hold a link and a value is one repeat', () => {
    const els: DensityTestElementSpec[] = [];
    for (let k = 1; k <= 4; k++) {
      const y = 100 + 40 * (k - 1);
      els.push(
        {
          id: `app.t.r${k}.a`,
          tag: 'a',
          xpath: `/html/body/table/tbody/tr[${k}]/td[1]/a`,
          rect: [0, y, 300, 40],
          text: `A-100${k}`,
        },
        {
          id: `app.t.r${k}.b`,
          tag: 'td',
          xpath: `/html/body/table/tbody/tr[${k}]/td[2]`,
          rect: [400, y, 400, 40],
          text: '12,50 €',
        }
      );
    }
    const reps = densityRepeats(capture(els), null);
    expect(reps.map((r) => [r.rows, r.perRow, r.members.length, r.valuesPerRow])).toEqual([
      [4, 2, 8, 2],
    ]);
  });

  it('a capture file written before the repeat keys existed reports its repeats unknown, not none', () => {
    const c = capture(orderList(3));
    const old = {
      ...c,
      repeatKeysResolved: undefined,
      items: c.items.map(({ siblingKey: _s, cousinKey: _c, cousinRowKey: _r, ...rest }) => rest),
    };
    const parsed = parseDensityCapture(JSON.parse(JSON.stringify(old)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.repeatKeysResolved).toBe(false);
    expect(summarizeDensityRepeats(parsed.value, null)).toEqual({
      structureResolved: true,
      repeatKeysResolved: false,
      reason:
        'this capture predates the sibling and cousin keys repeats are read from (repeatKeysResolved: false); capture it again',
    });
    // A capture written now round-trips with its keys.
    const fresh = parseDensityCapture(JSON.parse(JSON.stringify(c)));
    expect(fresh.ok && fresh.value.repeatKeysResolved).toBe(true);
  });

  it('fit-content links with no xpath chain are a repeat by left edge', () => {
    const els: DensityTestElementSpec[] = [
      { id: 'side', tag: 'div', xpath: '//*[@id="side"]', rect: [0, 0, 300, 400], text: '' },
      ...[73, 112, 90, 101].map(
        (w, i): DensityTestElementSpec => ({
          id: `side.l${i + 1}`,
          tag: 'a',
          xpath: `//*[@id="l${i + 1}"]`,
          rect: [16, 20 + 30 * i, w, 24],
          text: `Link ${i + 1}`,
        })
      ),
    ];
    const reps = densityRepeats(capture(els), null);
    expect(reps.map((r) => [r.id, r.by, r.rows])).toEqual([['repeat:side.l1', 'geometry', 4]]);
  });

  it('a card grid in list items with a title and a price each has three columns, row tag li', () => {
    const els: DensityTestElementSpec[] = [];
    for (let n = 0; n < 9; n++) {
      const x = 20 + 320 * (n % 3);
      const y = 100 + 120 * Math.floor(n / 3);
      els.push(
        {
          id: `c${n + 1}.title`,
          tag: 'a',
          xpath: `/html/body/main/ul/li[${n + 1}]/a`,
          rect: [x, y, 300, 24],
          text: `Card ${n + 1}`,
        },
        {
          id: `c${n + 1}.price`,
          tag: 'span',
          xpath: `/html/body/main/ul/li[${n + 1}]/span`,
          rect: [x, y + 30, 100, 20],
          text: '12,50 €',
        }
      );
    }
    const reps = densityRepeats(capture(els), null);
    expect(reps.map((r) => [r.tag, r.rows, r.perRow, r.members.length])).toEqual([
      ['li', 3, 3, 18],
    ]);
  });

  it('the fields of a form, and their labels, are not repeats', () => {
    const els: DensityTestElementSpec[] = [];
    for (let k = 1; k <= 3; k++) {
      els.push(
        {
          id: `lab${k}`,
          tag: 'label',
          xpath: `/html/body/form/label[${k}]`,
          rect: [0, 80 * k, 60 + 20 * k, 20],
          text: `Field ${k}`,
        },
        {
          id: `in${k}`,
          tag: 'input',
          role: 'textbox',
          category: 'interactive',
          xpath: `/html/body/form/input[${k}]`,
          rect: [0, 80 * k + 24, 400, 32],
          text: '',
        }
      );
    }
    expect(densityRepeats(capture(els), null)).toEqual([]);
  });

  it('a volume below the rendered rows is the measured extent of that many rows', () => {
    // The last row is shorter than the others: projecting backwards would give 20.
    const els = orderList(5).map((e): DensityTestElementSpec => {
      if (e.id !== 'app.orders.row-5') return e;
      const [x, y, w] = e.rect!;
      return { ...e, rect: [x, y, w, 20] };
    });
    const c = capture(els);
    expect(densityRepeats(c, null, { volume: 1 })[0].extentAtVolume).toEqual({ volume: 1, px: 36 });
    expect(densityRepeats(c, null, { volume: 2.5 })[0].extentAtVolume).toEqual({
      unknown: 'input_missing',
      reason: 'the declared row volume is not a positive safe integer',
    });
    // A volume whose projection would not be a finite number is refused too.
    expect(densityRepeats(c, null, { volume: 1e308 })[0].extentAtVolume).toEqual({
      unknown: 'input_missing',
      reason: 'the declared row volume is not a positive safe integer',
    });
  });

  it('form fields with their own ids, found by geometry, are not a repeat', () => {
    const els: DensityTestElementSpec[] = [
      { id: 'form', tag: 'form', xpath: '//*[@id="form"]', rect: [0, 0, 400, 200], text: '' },
      ...['name', 'email', 'password'].map(
        (n, i): DensityTestElementSpec => ({
          id: n,
          tag: 'input',
          role: 'textbox',
          category: 'interactive',
          xpath: `//*[@id="${n}"]`,
          rect: [10, 10 + 50 * i, 300, 32],
          text: '',
        })
      ),
    ];
    expect(densityRepeats(capture(els), null)).toEqual([]);
  });

  it('the headings of an article, between its paragraphs, are not a repeat', () => {
    const els: DensityTestElementSpec[] = [];
    for (let k = 1; k <= 3; k++) {
      const y = 200 * (k - 1);
      els.push(
        {
          id: `h${k}`,
          tag: 'h2',
          xpath: `/html/body/article/h2[${k}]`,
          rect: [0, y, 600, 30],
          text: `Section ${k}`,
        },
        {
          id: `p${k}`,
          tag: 'p',
          xpath: `/html/body/article/p[${k}]`,
          rect: [0, y + 40, 600, 140],
          text: `Synthetic paragraph ${k}`,
        }
      );
    }
    expect(densityRepeats(capture(els), null)).toEqual([]);
  });

  it('a header nav of items of different heights centred on one line is one row, not a repeat', () => {
    const rects: Array<[number, number, number, number]> = [
      [20, 10, 120, 40],
      [200, 20, 60, 20],
      [280, 20, 70, 20],
      [600, 14, 90, 32],
    ];
    const els: DensityTestElementSpec[] = rects.map((rect, i) => ({
      id: `nav.${i + 1}`,
      tag: 'a',
      xpath: `/html/body/header/nav/ul/li[${i + 1}]/a`,
      rect,
      text: `N${i + 1}`,
    }));
    expect(densityRepeats(capture(els), null)).toEqual([]);
  });

  it('a capture that claims its repeat keys while its items lack them does not parse', () => {
    const c = capture(orderList(3));
    const bad = {
      ...c,
      items: c.items.map(({ siblingKey: _s, cousinKey: _c, cousinRowKey: _r, ...rest }) => rest),
    };
    const parsed = parseDensityCapture(JSON.parse(JSON.stringify(bad)));
    expect(parsed.ok).toBe(false);
  });

  it('a padded one-line row is one line: the estimate never exceeds the row', () => {
    const els: DensityTestElementSpec[] = [1, 2, 3, 4].map((k) => ({
      id: `p.${k}`,
      tag: 'li',
      xpath: `/html/body/ul/li[${k}]`,
      rect: [0, 30 * (k - 1), 200, 30],
      text: 'x'.repeat(40),
    }));
    const [rep] = densityRepeats(capture(els), null);
    expect([rep.linesPerRow, rep.rowTextPx, rep.rowFill]).toEqual([1, 20, 20 / 30]);
  });

  it('a centred date beside a two-line title is two lines of text, never more than the row', () => {
    const els: DensityTestElementSpec[] = [];
    for (let k = 1; k <= 4; k++) {
      const y = 48 * (k - 1);
      els.push(
        {
          id: `r${k}`,
          tag: 'li',
          xpath: `/html/body/ul/li[${k}]`,
          rect: [0, y, 400, 40],
          text: '',
        },
        {
          id: `r${k}.t`,
          tag: 'span',
          xpath: `/html/body/ul/li[${k}]/span[1]`,
          rect: [0, y, 200, 40],
          text: 'x'.repeat(40),
        },
        {
          id: `r${k}.d`,
          tag: 'span',
          xpath: `/html/body/ul/li[${k}]/span[2]`,
          rect: [300, y + 10, 80, 20],
          text: '16.10.2026',
        }
      );
    }
    const [rep] = densityRepeats(capture(els), null);
    expect([rep.rows, rep.linesPerRow, rep.rowTextPx, rep.rowFill]).toEqual([4, 2, 40, 40 / 48]);
  });

  it('a hidden text field above a list is not its finder', () => {
    const els: DensityTestElementSpec[] = [
      {
        id: 'q.mobile',
        tag: 'input',
        role: 'textbox',
        category: 'interactive',
        xpath: `${SECTION}/input`,
        rect: [0, 0, 0, 0],
        visible: false,
        visibilityReason: 'no-layout',
        text: '',
      },
      ...orderList(4),
      // A visible pager below gives the list a scope the hidden field is in.
      {
        id: 'next',
        tag: 'button',
        category: 'interactive',
        xpath: `${SECTION}/nav/button`,
        rect: [0, 320, 80, 28],
        text: 'Next',
      },
    ];
    const reps = densityRepeats(capture(els), null);
    expect(reps.map((r) => [r.rows, r.scope, r.finder])).toEqual([[4, 'block', null]]);
  });

  it('a wrapped run of chips is not a list of its line-starting chips', () => {
    const lines: number[][] = [
      [60, 90, 120, 70],
      [80, 50, 140],
      [100, 75],
    ];
    const els: DensityTestElementSpec[] = [];
    let n = 0;
    lines.forEach((widths, li) => {
      let x = 0;
      for (const w of widths) {
        n++;
        els.push({
          id: `chip-${n}`,
          tag: 'a',
          category: 'interactive',
          xpath: `/html/body/div/a[${n}]`,
          rect: [x, 100 + 32 * li, w, 24],
          text: `Tag ${n}`,
        });
        x += w + 8;
      }
    });
    expect(densityRepeats(capture(els), null)).toEqual([]);
  });

  it('a row whose text leaf states a zero line height is not estimated', () => {
    const els = orderList(3).map((e) =>
      e.id === 'app.orders.row-2.no' ? { ...e, styles: { lineHeight: '0px' } } : e
    );
    const [rep] = densityRepeats(capture(els), null);
    expect([rep.rowsEstimated, rep.linesPerRow]).toEqual([2, 1]);
  });

  it('a grouped list of registered rows is one repeat per group, counted in rows', () => {
    const els: DensityTestElementSpec[] = [];
    let y = 0;
    for (let g = 1; g <= 3; g++) {
      y += 30;
      for (let k = 1; k <= 5; k++) {
        els.push({
          id: `g${g}.r${k}`,
          tag: 'li',
          xpath: `/html/body/ul/li[${g}]/ul/li[${k}]`,
          rect: [0, y, 600, 36],
          text: `Row ${g}.${k}`,
        });
        y += 40;
      }
    }
    const reps = densityRepeats(capture(els), null);
    expect(reps.map((r) => [r.id, r.rows, r.rowPitchPx])).toEqual([
      ['repeat:g1.r1', 5, 40],
      ['repeat:g2.r1', 5, 40],
      ['repeat:g3.r1', 5, 40],
    ]);
  });

  it('wrapped chips in list items nobody registered are not a grid', () => {
    const widths = [60, 80, 50, 90, 70, 60, 100, 55, 65, 75, 85, 45];
    const els: DensityTestElementSpec[] = [];
    let x = 0;
    let line = 0;
    widths.forEach((w, i) => {
      if (x + w > 330) {
        x = 0;
        line++;
      }
      els.push({
        id: `a${i + 1}`,
        tag: 'a',
        category: 'interactive',
        xpath: `/html/body/article/ul/li[${i + 1}]/a`,
        rect: [x, 100 + 30 * line, w, 24],
        text: `Tag ${i + 1}`,
      });
      x += w + 8;
    });
    expect(densityRepeats(capture(els), null)).toEqual([]);
  });

  it('wrappers each holding a label and a field are a form, not a list', () => {
    const els: DensityTestElementSpec[] = [];
    for (let k = 1; k <= 4; k++) {
      const y = 60 * (k - 1);
      els.push(
        {
          id: `fw${k}`,
          tag: 'div',
          xpath: `/html/body/form/div[${k}]`,
          rect: [0, y, 400, 56],
          text: `F${k}`,
        },
        {
          id: `fw${k}.l`,
          tag: 'label',
          xpath: `/html/body/form/div[${k}]/label`,
          rect: [0, y, 100, 20],
          text: `F${k}`,
        },
        {
          id: `fw${k}.i`,
          tag: 'input',
          role: 'textbox',
          category: 'interactive',
          xpath: `/html/body/form/div[${k}]/input`,
          rect: [0, y + 22, 400, 30],
          text: '',
        }
      );
    }
    expect(densityRepeats(capture(els), null)).toEqual([]);
  });

  it('field wrappers with help text are a form; todo rows with a checkbox are a list', () => {
    const form: DensityTestElementSpec[] = [];
    const todo: DensityTestElementSpec[] = [];
    for (let k = 1; k <= 4; k++) {
      const y = 70 * (k - 1);
      form.push(
        {
          id: `f${k}`,
          tag: 'div',
          xpath: `/html/body/form/div[${k}]`,
          rect: [0, y, 400, 66],
          text: '',
        },
        {
          id: `f${k}.l`,
          tag: 'label',
          xpath: `/html/body/form/div[${k}]/label`,
          rect: [0, y, 100, 20],
          text: `F${k}`,
        },
        {
          id: `f${k}.i`,
          tag: 'input',
          role: 'textbox',
          category: 'interactive',
          xpath: `/html/body/form/div[${k}]/input`,
          rect: [0, y + 22, 400, 24],
          text: '',
        },
        {
          id: `f${k}.p`,
          tag: 'p',
          xpath: `/html/body/form/div[${k}]/p`,
          rect: [0, y + 48, 300, 16],
          text: 'Help',
        }
      );
      const t = 500 + 40 * (k - 1);
      todo.push(
        {
          id: `t${k}`,
          tag: 'li',
          xpath: `/html/body/ul/li[${k}]`,
          rect: [0, t, 400, 36],
          text: `Task ${k}`,
        },
        {
          id: `t${k}.c`,
          tag: 'input',
          role: 'checkbox',
          category: 'interactive',
          xpath: `/html/body/ul/li[${k}]/input`,
          rect: [0, t + 8, 20, 20],
          text: '',
        },
        {
          id: `t${k}.s`,
          tag: 'span',
          xpath: `/html/body/ul/li[${k}]/span`,
          rect: [30, t + 8, 200, 20],
          text: `Task ${k}`,
        }
      );
    }
    expect(densityRepeats(capture([...form, ...todo]), null).map((r) => [r.id, r.rows])).toEqual([
      ['repeat:t1', 4],
    ]);
  });

  it('a table whose leading badge appears in some rows only is still one repeat', () => {
    const els: DensityTestElementSpec[] = [];
    for (let k = 1; k <= 5; k++) {
      const y = 100 + 40 * (k - 1);
      if (k % 2 === 1) {
        els.push({
          id: `b${k}`,
          tag: 'span',
          xpath: `/html/body/table/tbody/tr[${k}]/td[1]/span`,
          rect: [8, y + 10, 40, 20],
          text: 'New',
        });
      }
      els.push(
        {
          id: `l${k}`,
          tag: 'a',
          xpath: `/html/body/table/tbody/tr[${k}]/td[2]/a`,
          rect: [100, y + 10, 200, 20],
          text: `Item ${k}`,
        },
        {
          id: `e${k}`,
          tag: 'button',
          category: 'interactive',
          xpath: `/html/body/table/tbody/tr[${k}]/td[3]/button`,
          rect: [600, y + 6, 60, 28],
          text: 'Edit',
        }
      );
    }
    const reps = densityRepeats(capture(els), null);
    expect(reps.map((r) => [r.tag, r.rows])).toEqual([['tr', 5]]);
  });

  it('a declared value rule the capture could not resolve makes valuesPerRow unknown', () => {
    // A `text` matcher the capture never evaluated: it is unresolved.
    const t = parseDensityTargets({
      schema: 'ui-bridge/density-targets@1',
      surface: '/',
      profile: 'audience_profile/synthetic@1',
      classify: [{ match: { text: 'Pending' }, kind: 'value' }],
      roles: [],
    });
    if (!t.ok) throw new Error(JSON.stringify(t.problems));
    const [rep] = densityRepeats(capture(orderList(3)), t.value);
    expect(rep.valuesPerRow).toBeNull();
    expect(densityRepeats(capture(orderList(3)), null)[0].valuesPerRow).toBe(2);
  });

  it('an inline leaf wrapping to two lines counts two', () => {
    const els = orderList(3).map((e) =>
      e.id.endsWith('.sum')
        ? {
            ...e,
            text: 'x'.repeat(20),
            rect: [300, e.rect![1], 100, 34] as [number, number, number, number],
          }
        : e
    );
    // 20 characters at 14 px over 100 px is 2 lines; 34 px = one 20 px line + one 14 px content box.
    const [rep] = densityRepeats(capture(els), null);
    expect(rep.linesPerRow).toBe(2);
  });

  it('a capture whose cousinRowKey disagrees with its cousinKey does not parse', () => {
    const c = capture(orderList(3));
    const bad = { ...c, items: c.items.map((i, n) => (n === 0 ? { ...i, cousinRowKey: 'x' } : i)) };
    expect(parseDensityCapture(JSON.parse(JSON.stringify(bad))).ok).toBe(false);
  });

  it('a row holding a redacted control leaf is not counted, never zero', () => {
    // Rows nobody registered: link plus value spans (row 1: one value, rows
    // 3 and 4: two, row 2: none and its link redacted).
    const els: DensityTestElementSpec[] = [];
    const valuesIn = [1, 0, 2, 2];
    valuesIn.forEach((n, i) => {
      const k = i + 1;
      const y = 100 + 40 * i;
      els.push({
        id: `r${k}.a`,
        tag: 'a',
        category: 'interactive',
        xpath: `/html/body/ul/li[${k}]/a`,
        rect: [0, y, 200, 20],
        text: `Item ${k}`,
        redacted: k === 2,
      });
      for (let j = 1; j <= n; j++) {
        els.push({
          id: `r${k}.v${j}`,
          tag: 'span',
          xpath: `/html/body/ul/li[${k}]/span[${j}]`,
          rect: [200 + 100 * j, y, 80, 20],
          text: '12,50 €',
        });
      }
    });
    const [rep] = densityRepeats(capture(els), null);
    expect([rep.rows, rep.valuesPerRow]).toEqual([4, 2]);
  });

  it('members at coordinates no page lays out form no repeat', () => {
    const els: DensityTestElementSpec[] = [0, 1e308, 1.7e308].map((y, i) => ({
      id: `far${i + 1}`,
      tag: 'li',
      xpath: `/html/body/ul/li[${i + 1}]`,
      rect: [0, y, 300, 30],
      text: `Row ${i + 1}`,
    }));
    expect(densityRepeats(capture(els), null)).toEqual([]);
  });

  it('a leaf at a coordinate no page lays out makes its row unknown', () => {
    const els = orderList(3).map((e): DensityTestElementSpec => {
      if (e.id !== 'app.orders.row-2.sum') return e;
      return {
        ...e,
        rect: [300, 1.7e308, 100, 20],
      };
    });
    const [rep] = densityRepeats(capture(els), null);
    expect([rep.rows, rep.rowsEstimated, rep.linesPerRow, rep.rowTextPx]).toEqual([3, 2, 1, 20]);
    expect(Number.isFinite(rep.rowFill!)).toBe(true);
  });

  it('a sub-pixel forged width and line height make the row unknown, never Infinity', () => {
    const els = orderList(3).map((e): DensityTestElementSpec => {
      if (e.id !== 'app.orders.row-2.sum' && e.id !== 'app.orders.row-3.sum') return e;
      const [x, y] = e.rect!;
      return {
        ...e,
        text: 'x'.repeat(1000),
        rect: [x, y, 5e-324, 20],
        styles: { lineHeight: `0.${'0'.repeat(319)}1px` },
      };
    });
    const [rep] = densityRepeats(capture(els), null);
    expect([rep.rowsEstimated, rep.linesPerRow, rep.rowTextPx]).toEqual([1, 1, 20]);
  });

  it('a normal leaf with only a forged huge line height is not estimated', () => {
    const els = orderList(3).map((e) =>
      e.id === 'app.orders.row-2.sum' ? { ...e, styles: { lineHeight: `1${'0'.repeat(20)}px` } } : e
    );
    const [rep] = densityRepeats(capture(els), null);
    expect([rep.rowsEstimated, rep.linesPerRow]).toEqual([2, 1]);
  });

  it('a sub-pixel line height on every text leaf leaves the rows unknown, not zero', () => {
    const els = orderList(3).map((e) =>
      e.tag === 'span' ? { ...e, styles: { lineHeight: '0.000001px' } } : e
    );
    const [rep] = densityRepeats(capture(els), null);
    expect([rep.rowsEstimated, rep.linesPerRow, rep.rowTextPx, rep.rowFill]).toEqual([
      0,
      null,
      null,
      null,
    ]);
  });

  it('a hidden leaf in a row draws no line band', () => {
    const els = orderList(3).map((e): DensityTestElementSpec => {
      if (!e.id.endsWith('.sum')) return e;
      const [x, y, w, h] = e.rect!;
      return { ...e, rect: [x, y + 20, w, h], visible: false, visibilityReason: 'hidden' };
    });
    const [rep] = densityRepeats(capture(els), null);
    expect([rep.linesPerRow, rep.rowTextPx]).toEqual([1, 20]);
  });

  it('the summary counts members, caps the list, and reports the total', () => {
    // The cards moved 600 px right, beside the list.
    const beside = cards([
      [100, 300],
      [100, 300],
      [100, 300],
    ]).map((e): DensityTestElementSpec => {
      const [x, y, w, h] = e.rect!;
      return { ...e, rect: [x + 600, y, w, h] };
    });
    const c = capture([...orderList(3), ...beside]);
    const report = summarizeDensityRepeats(c, null, undefined, 1);
    expect(report.structureResolved).toBe(true);
    if (!report.structureResolved) return;
    expect([report.byBasis, report.shown, report.total, report.truncated]).toEqual([
      { path: 1, geometry: 1 },
      1,
      2,
      true,
    ]);
    expect(report.list[0].members).toBe(3);
  });

  it('a capture whose structure is not resolved reports no repeats, and says why', () => {
    const c = { ...capture(orderList(3)), structureResolved: false };
    expect(summarizeDensityRepeats(c, null)).toEqual({
      structureResolved: false,
      reason: 'repeats are read from parent links, which this capture has not resolved',
    });
  });

  it('a capture file written before selected and filters existed still parses', () => {
    const c = capture(orderList(3));
    const old = {
      ...c,
      items: c.items.map(({ selected: _s, filters: _f, ...rest }) => rest),
    };
    const parsed = parseDensityCapture(JSON.parse(JSON.stringify(old)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.items.every((i) => i.selected === null && i.filters === null)).toBe(true);
    }
  });
});
