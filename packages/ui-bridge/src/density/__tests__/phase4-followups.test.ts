// @vitest-environment node
/**
 * The follow-ups recorded against Phase 4 (qontinui/ui-bridge#501): repeats,
 * affordances and the forged-geometry readers of structure, each over a
 * hand-built snapshot with literal expected values.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 4).
 */
import { describe, expect, it } from 'vitest';
import { densityAffordances, summarizeDensityAffordances } from '../affordances';
import { captureDensityFromSnapshot } from '../capture-from-snapshot';
import { densityNavPrefix, densityRepeats, densitySameNav } from '../repeats';
import { parseDensityCapture, type DensityCapture, type DensityItem } from '../schema';
import { densityBlocks, densityPins } from '../structure';
import {
  DENSITY_TEST_PRODUCER,
  densityTestSnapshot,
  type DensityTestElementSpec,
  type DensityTestSnapshotSpec,
} from './fixtures/snapshot-builder';

function capture(
  elements: DensityTestElementSpec[],
  relationships?: DensityTestSnapshotSpec['relationships']
): DensityCapture {
  const obs = captureDensityFromSnapshot(densityTestSnapshot({ elements, relationships }), {
    producer: DENSITY_TEST_PRODUCER,
    evaluatedAt: '2026-11-23T10:00:00.000Z',
  });
  if (obs.status !== 'measured') throw new Error(`expected measured, got ${JSON.stringify(obs)}`);
  return obs.value;
}

const MAIN = '/html/body/main';

describe('Phase 4 follow-ups: repeats', () => {
  it('runs with no DOM', () => {
    expect(typeof document).toBe('undefined');
  });

  it('a definition list of four term and definition pairs is one repeat of four rows', () => {
    const els: DensityTestElementSpec[] = [];
    for (let k = 1; k <= 4; k++) {
      const y = 100 + 48 * (k - 1);
      els.push(
        {
          id: `app.facts.term-${k}`,
          tag: 'dt',
          xpath: `${MAIN}/dl/dt[${k}]`,
          rect: [0, y, 200, 20],
          text: `Term ${k}`,
        },
        {
          id: `app.facts.def-${k}`,
          tag: 'dd',
          xpath: `${MAIN}/dl/dd[${k}]`,
          rect: [40, y + 22, 300, 20],
          text: `Definition ${k}`,
        }
      );
    }
    const reps = densityRepeats(capture(els), null);
    expect(
      reps.map((r) => [r.id, r.tag, r.rows, r.perRow, r.rowPitchPx, r.members.length, r.firstRow])
    ).toEqual([['repeat:app.facts.term-1', 'dt', 4, 2, 48, 8, { topPx: 100, bottomPx: 142 }]]);
  });

  it('a definition list whose definitions sit a pixel above their terms, side by side, is one repeat', () => {
    const els: DensityTestElementSpec[] = [];
    for (let k = 1; k <= 4; k++) {
      const y = 100 + 30 * (k - 1);
      els.push(
        {
          id: `app.kv.term-${k}`,
          tag: 'dt',
          xpath: `${MAIN}/dl/dt[${k}]`,
          rect: [0, y, 200, 20],
          text: `Key ${k}`,
        },
        {
          id: `app.kv.def-${k}`,
          tag: 'dd',
          xpath: `${MAIN}/dl/dd[${k}]`,
          rect: [220, y - 1, 300, 20],
          text: `Value ${k}`,
        }
      );
    }
    const reps = densityRepeats(capture(els), null);
    expect(reps.map((r) => [r.id, r.rows, r.perRow, r.members.length])).toEqual([
      ['repeat:app.kv.term-1', 4, 2, 8],
    ]);
  });

  it('a header row of th cells in tbody is not a data row', () => {
    const cells: DensityTestElementSpec[] = [];
    for (let j = 1; j <= 2; j++) {
      cells.push({
        id: `app.t.h${j}`,
        tag: 'th',
        xpath: `${MAIN}/table/tbody/tr[1]/th[${j}]`,
        rect: [300 * (j - 1), 100, 300, 32],
        text: `Column ${j}`,
      });
    }
    for (let k = 2; k <= 4; k++) {
      for (let j = 1; j <= 2; j++) {
        cells.push({
          id: `app.t.r${k}c${j}`,
          tag: 'td',
          xpath: `${MAIN}/table/tbody/tr[${k}]/td[${j}]`,
          rect: [300 * (j - 1), 132 + 40 * (k - 2), 300, 40],
          text: `R${k}C${j}`,
        });
      }
    }
    const c = capture(cells);
    expect(c.items.filter((i) => i.tag === 'th').map((i) => i.cousinKey)).toEqual([null, null]);
    const reps = densityRepeats(c, null);
    expect(reps.map((r) => [r.id, r.rows, r.members.length, r.firstRow.topPx])).toEqual([
      ['repeat:app.t.r2c1', 3, 6, 132],
    ]);
  });

  it('a table whose only registered cells are row headers keeps every row', () => {
    const cells: DensityTestElementSpec[] = [1, 2, 3].map((k) => ({
      id: `app.t.rh${k}`,
      tag: 'th',
      xpath: `${MAIN}/table/tbody/tr[${k}]/th`,
      rect: [0, 100 + 40 * (k - 1), 200, 40],
      text: `Row ${k}`,
    }));
    const reps = densityRepeats(capture(cells), null);
    expect(reps.map((r) => [r.id, r.rows])).toEqual([['repeat:app.t.rh1', 3]]);
  });

  it('three stacked sections of one width are layout, three stacked articles a feed', () => {
    const stack = (tag: string): DensityTestElementSpec[] =>
      [1, 2, 3].flatMap((k): DensityTestElementSpec[] => [
        {
          id: `app.${tag}.${k}`,
          tag,
          xpath: `${MAIN}/${tag}[${k}]`,
          rect: [0, 100 + 300 * (k - 1), 800, 280],
          text: `Heading ${k}`,
        },
        {
          id: `app.${tag}.${k}.title`,
          tag: 'h2',
          xpath: `${MAIN}/${tag}[${k}]/h2`,
          rect: [0, 100 + 300 * (k - 1), 800, 28],
          text: `Heading ${k}`,
        },
      ]);
    expect(densityRepeats(capture(stack('section')), null)).toEqual([]);
    expect(densityRepeats(capture(stack('article')), null).map((r) => [r.id, r.rows])).toEqual([
      ['repeat:app.article.1', 3],
    ]);
  });

  it('one wider row does not discard the column of equal rows around it', () => {
    const els: DensityTestElementSpec[] = [];
    for (let k = 1; k <= 6; k++) {
      const y = 100 + 50 * (k - 1);
      els.push(
        {
          id: `app.rows.${k}`,
          tag: 'div',
          xpath: `${MAIN}/div/div[${k}]`,
          rect: [0, y, k === 3 ? 640 : 600, 44],
          text: `Row ${k}`,
        },
        {
          id: `app.rows.${k}.label`,
          tag: 'span',
          xpath: `${MAIN}/div/div[${k}]/span`,
          rect: [8, y + 12, 200, 20],
          text: `Row ${k}`,
        }
      );
    }
    const reps = densityRepeats(capture(els), null);
    expect(reps.map((r) => [r.id, r.rows, r.members])).toEqual([
      [
        'repeat:app.rows.1',
        6,
        ['app.rows.1', 'app.rows.2', 'app.rows.3', 'app.rows.4', 'app.rows.5', 'app.rows.6'],
      ],
    ]);
  });

  it('stacked containers of two alternating widths are layout, not two lists', () => {
    const els: DensityTestElementSpec[] = [];
    for (let k = 1; k <= 6; k++) {
      const y = 100 + 300 * (k - 1);
      els.push(
        {
          id: `app.band.${k}`,
          tag: 'div',
          xpath: `${MAIN}/div/div[${k}]`,
          rect: [0, y, k % 2 === 1 ? 1200 : 800, 280],
          text: `Band ${k}`,
        },
        {
          id: `app.band.${k}.title`,
          tag: 'span',
          xpath: `${MAIN}/div/div[${k}]/span`,
          rect: [8, y + 8, 300, 20],
          text: `Band ${k}`,
        }
      );
    }
    expect(densityRepeats(capture(els), null).map((r) => r.id)).toEqual([]);
  });

  it('three stacked containers where only two share a width are layout, not a list', () => {
    const els: DensityTestElementSpec[] = [];
    [1200, 1200, 800].forEach((w, i) => {
      const k = i + 1;
      const y = 100 + 300 * i;
      els.push(
        {
          id: `app.lay.${k}`,
          tag: 'div',
          xpath: `${MAIN}/div/div[${k}]`,
          rect: [0, y, w, 280],
          text: `Part ${k}`,
        },
        {
          id: `app.lay.${k}.title`,
          tag: 'span',
          xpath: `${MAIN}/div/div[${k}]/span`,
          rect: [8, y + 8, 300, 20],
          text: `Part ${k}`,
        }
      );
    });
    expect(densityRepeats(capture(els), null).map((r) => r.id)).toEqual([]);
  });

  /** A grid of `n` sibling cards, three per row, whose short last row is centred. */
  function centredGrid(n: number, cousins: boolean): DensityTestElementSpec[] {
    const els: DensityTestElementSpec[] = cousins
      ? []
      : [{ id: 'app.g', tag: 'div', xpath: `${MAIN}/div`, rect: [0, 90, 960, 400], text: '' }];
    const full = n - (n % 3);
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 3);
      const inLast = i >= full;
      const shift = inLast ? (320 * (3 - (n % 3))) / 2 : 0;
      els.push({
        id: `app.g.${i + 1}`,
        tag: cousins ? 'a' : 'div',
        xpath: cousins ? `${MAIN}/ul/li[${i + 1}]/a` : `${MAIN}/div/div[${i + 1}]`,
        rect: [shift + 320 * (i % 3), 100 + 110 * row, 300, 100],
        text: `Card ${i + 1}`,
      });
    }
    return els;
  }

  it('a card grid whose short last row is centred is one repeat with that row', () => {
    const reps = densityRepeats(capture(centredGrid(8, false)), null);
    expect(reps.map((r) => [r.id, r.rows, r.perRow, r.members.length])).toEqual([
      ['repeat:app.g.1', 3, 3, 8],
    ]);
  });

  it('a card grid in unregistered list items whose short last row is centred is one repeat', () => {
    const reps = densityRepeats(capture(centredGrid(8, true)), null);
    expect(reps.map((r) => [r.id, r.rows, r.perRow, r.members.length])).toEqual([
      ['repeat:app.g.1', 3, 3, 8],
    ]);
  });
});

describe('Phase 4 follow-ups: finders, filters and pagers', () => {
  const SECTION = `${MAIN}/section`;

  /** A section nobody registered: a search box above a table of unregistered rows. */
  function unregisteredTable(): DensityTestElementSpec[] {
    const els: DensityTestElementSpec[] = [
      {
        id: 'app.find',
        tag: 'input',
        role: 'searchbox',
        category: 'interactive',
        xpath: `${SECTION}/input`,
        rect: [0, 100, 300, 28],
        text: '',
      },
    ];
    for (let k = 1; k <= 3; k++) {
      for (let j = 1; j <= 2; j++) {
        els.push({
          id: `app.t.r${k}c${j}`,
          tag: 'td',
          xpath: `${SECTION}/table/tbody/tr[${k}]/td[${j}]`,
          rect: [300 * (j - 1), 140 + 40 * (k - 1), 300, 40],
          text: `R${k}C${j}`,
        });
      }
    }
    return els;
  }

  it('a table with no registered container finds the search box above it as its finder', () => {
    const [rep] = densityRepeats(capture(unregisteredTable()), null);
    expect([rep.id, rep.parent, rep.scope, rep.finder]).toEqual([
      'repeat:app.t.r1c1',
      null,
      'block',
      { id: 'app.find', by: 'position', alsoFilters: false },
    ]);
  });

  it('a select-all checkbox in a th cell of tbody is not a filter', () => {
    const els: DensityTestElementSpec[] = [
      {
        id: 'app.all',
        tag: 'input',
        role: 'checkbox',
        category: 'interactive',
        xpath: `${SECTION}/table/tbody/tr[1]/th/input`,
        rect: [4, 104, 20, 20],
        text: '',
      },
      {
        id: 'app.head',
        tag: 'th',
        xpath: `${SECTION}/table/tbody/tr[1]/th`,
        rect: [0, 100, 600, 32],
        text: '',
      },
    ];
    for (let k = 2; k <= 4; k++) {
      els.push({
        id: `app.t.r${k}`,
        tag: 'td',
        xpath: `${SECTION}/table/tbody/tr[${k}]/td`,
        rect: [0, 132 + 40 * (k - 2), 600, 40],
        text: `Row ${k}`,
      });
    }
    const c = capture(els);
    const reps = densityRepeats(c, null);
    expect(reps.map((r) => [r.id, r.rows])).toEqual([['repeat:app.t.r2', 3]]);
    expect(
      densityAffordances(c, null, { repeats: reps }).filter((a) => a.kind === 'filter')
    ).toEqual([]);
  });

  it('a filters edge to a parent two repeats share is a filter of both', () => {
    const els: DensityTestElementSpec[] = [
      {
        id: 'app.pick',
        tag: 'select',
        role: 'combobox',
        category: 'interactive',
        xpath: `${MAIN}/aside/select`,
        rect: [700, 100, 200, 28],
        text: 'All',
      },
      { id: 'app.rows', tag: 'div', xpath: `${MAIN}/div`, rect: [0, 100, 600, 120], text: '' },
    ];
    for (let k = 1; k <= 3; k++) {
      const y = 100 + 40 * (k - 1);
      els.push(
        {
          id: `app.rows.link-${k}`,
          tag: 'a',
          category: 'interactive',
          xpath: `${MAIN}/div/a[${k}]`,
          rect: [0, y, 200, 20],
          text: `Item ${k}`,
        },
        {
          id: `app.rows.act-${k}`,
          tag: 'button',
          category: 'interactive',
          xpath: `${MAIN}/div/button[${k}]`,
          rect: [400, y, 100, 20],
          text: 'Open',
        }
      );
    }
    const c = capture(els, [{ source: 'app.pick', target: 'app.rows', type: 'filters' }]);
    const reps = densityRepeats(c, null);
    expect(reps.map((r) => [r.id, r.parent])).toEqual([
      ['repeat:app.rows.act-1', 'app.rows'],
      ['repeat:app.rows.link-1', 'app.rows'],
    ]);
    // The select's edge makes it the finder of both, which also filters each
    // (reported once per repeat, as the finder, never again as a filter).
    expect(reps.map((r) => r.finder)).toEqual([
      { id: 'app.pick', by: 'relationship', alsoFilters: true },
      { id: 'app.pick', by: 'relationship', alsoFilters: true },
    ]);
    expect(
      densityAffordances(c, null, { repeats: reps })
        .filter((a) => a.kind === 'filter')
        .map((a) => [a.id, a.rule, a.repeat])
    ).toEqual([]);
  });

  it("a controls edge to a list nested in the first row of another is that inner list's filter", () => {
    const els: DensityTestElementSpec[] = [
      {
        id: 'app.pick',
        tag: 'select',
        role: 'combobox',
        category: 'interactive',
        xpath: `${MAIN}/aside/select`,
        rect: [700, 100, 200, 28],
        text: 'All',
      },
    ];
    for (let k = 1; k <= 3; k++) {
      const y = 100 + 200 * (k - 1);
      els.push({
        id: `app.outer.${k}`,
        tag: 'li',
        xpath: `${MAIN}/ul/li[${k}]`,
        rect: [0, y, 600, 180],
        text: `Group ${k}`,
      });
    }
    for (let j = 1; j <= 3; j++) {
      els.push(
        {
          id: `app.inner.${j}`,
          tag: 'div',
          xpath: `${MAIN}/ul/li[1]/div[${j}]`,
          rect: [20, 120 + 40 * (j - 1), 500, 36],
          text: `Item ${j}`,
        },
        {
          id: `app.inner.${j}.label`,
          tag: 'span',
          xpath: `${MAIN}/ul/li[1]/div[${j}]/span`,
          rect: [28, 128 + 40 * (j - 1), 200, 20],
          text: `Item ${j}`,
        }
      );
    }
    const c = capture(els, [{ source: 'app.pick', target: 'app.inner.2', type: 'controls' }]);
    const reps = densityRepeats(c, null);
    expect(reps.map((r) => [r.id, r.parent])).toEqual([
      ['repeat:app.outer.1', null],
      ['repeat:app.inner.1', 'app.outer.1'],
    ]);
    // The inner list's finder by that edge (which also filters it); the
    // outer list's, never.
    expect(reps.map((r) => r.finder)).toEqual([
      null,
      { id: 'app.pick', by: 'relationship', alsoFilters: true },
    ]);
    expect(
      densityAffordances(c, null, { repeats: reps })
        .filter((a) => a.kind === 'filter')
        .map((a) => [a.id, a.rule, a.repeat])
    ).toEqual([]);
  });

  it('a root-chain key and an anchored tag path inside one nav name one nav; sibling navs two', () => {
    const item = (path: string[], siblingKey: string | null): DensityItem =>
      ({ path, siblingKey, cousinRowKey: null }) as unknown as DensityItem;
    const tags = ['html', 'body', 'main', 'section', 'nav'];
    const rooted = densityNavPrefix(item(tags, '/html/body/main/section/nav'));
    const anchored = densityNavPrefix(item([...tags, 'ul', 'li'], '@id=pages/li[2]'));
    expect([rooted, anchored]).toEqual([
      'key:/html/body/main/section/nav',
      'tags:html/body/main/section/nav',
    ]);
    expect(densitySameNav(rooted, anchored)).toBe(true);
    const first = densityNavPrefix(item(tags, '/html/body/main/section/nav[1]/ul'));
    const second = densityNavPrefix(item(tags, '/html/body/main/section/nav[2]'));
    expect(densitySameNav(first, second)).toBe(false);
  });

  it('a pager in the nav beside the nav its list sits in is the pager of that list', () => {
    const els: DensityTestElementSpec[] = [
      { id: 'app.s', tag: 'section', xpath: SECTION, rect: [0, 90, 600, 260], text: '' },
    ];
    for (let k = 1; k <= 4; k++) {
      els.push({
        id: `app.s.link-${k}`,
        tag: 'a',
        category: 'interactive',
        xpath: `${SECTION}/nav[1]/ul/li[${k}]/a`,
        rect: [0, 100 + 32 * (k - 1), 200, 24],
        text: `Page ${k}`,
      });
    }
    for (let k = 1; k <= 2; k++) {
      els.push({
        id: `app.s.pg-${k}`,
        tag: 'button',
        category: 'interactive',
        xpath: `${SECTION}/nav[2]/button[${k}]`,
        rect: [100 * (k - 1), 240, 80, 28],
        text: k === 1 ? 'Previous' : 'Next',
      });
    }
    const c = capture(els);
    const reps = densityRepeats(c, null);
    expect(reps.map((r) => r.id)).toEqual(['repeat:app.s.link-1']);
    expect(
      densityAffordances(c, null, { repeats: reps })
        .filter((a) => a.kind === 'pager')
        .map((a) => [a.id, a.repeat, a.members])
    ).toEqual([['app.s.pg-1', 'repeat:app.s.link-1', ['app.s.pg-1', 'app.s.pg-2']]]);
  });
});

describe('Phase 4 follow-ups: the affordances report', () => {
  it('a capture written before the repeat keys existed still reports its item-local affordances', () => {
    const c = capture([
      {
        id: 'app.find',
        tag: 'input',
        role: 'searchbox',
        category: 'interactive',
        xpath: `${MAIN}/input`,
        rect: [0, 100, 300, 28],
        text: '',
      },
      {
        id: 'app.tab',
        tag: 'button',
        role: 'tab',
        category: 'interactive',
        xpath: `${MAIN}/div/button`,
        rect: [0, 140, 100, 28],
        text: 'Tab',
        ariaSelected: false,
      },
    ]);
    const old = {
      ...c,
      repeatKeysResolved: undefined,
      items: c.items.map(({ siblingKey: _s, cousinKey: _c, cousinRowKey: _r, ...rest }) => rest),
    };
    const parsed = parseDensityCapture(JSON.parse(JSON.stringify(old)));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed));
    // The measure door passes the item-local affordances it read with no repeats.
    const report = summarizeDensityAffordances(
      parsed.value,
      null,
      densityAffordances(parsed.value, null, { repeats: [] })
    );
    expect(report).toMatchObject({
      structureResolved: true,
      repeatKeysResolved: false,
      interactionsBasis: 'static',
      byKind: {
        disclosure: 0,
        tab: 1,
        menu: 0,
        search: 1,
        filter: null,
        pager: null,
        truncation: 0,
        abbreviation: 0,
      },
      total: 2,
    });
  });

  it('a leaf named by its title whose text is redacted is counted undetermined, not dropped', () => {
    const c = capture([
      {
        id: 'app.code',
        tag: 'span',
        xpath: `${MAIN}/span[1]`,
        rect: [0, 100, 40, 20],
        text: 'ABC',
        nameSource: 'title',
        redacted: true,
      },
      {
        id: 'app.plain',
        tag: 'span',
        xpath: `${MAIN}/span[2]`,
        rect: [0, 130, 40, 20],
        text: 'XYZ',
        nameSource: 'title',
      },
    ]);
    const report = summarizeDensityAffordances(c, null);
    expect(report).toMatchObject({
      byKind: { abbreviation: 1 },
      abbreviationsUndetermined: 1,
    });
  });
});

describe('Phase 4 follow-ups: forged geometry in pins and blocks', () => {
  /** One laid-out leaf of the capture, with its rect replaced. */
  function withRect(c: DensityCapture, rect: DensityItem['rect']): DensityCapture {
    return { ...c, items: c.items.map((i) => ({ ...i, rect })) };
  }

  const bar = (): DensityCapture =>
    capture([
      {
        id: 'app.bar',
        tag: 'div',
        xpath: `${MAIN}/div`,
        rect: [0, 0, 1280, 60],
        text: 'Bar',
        styles: { position: 'fixed' },
      },
    ]);

  it('a pin read straight from a forged capture object is no pin, never an Infinity', () => {
    const good = bar();
    expect(densityPins(good)).toMatchObject({ pinTopPx: 60, ids: ['app.bar'] });
    const forged = withRect(good, { x: 0, y: 0, w: 1e308 * 10, h: 60 });
    expect(densityPins(forged)).toEqual({
      pinTopPx: 0,
      pinBottomPx: 0,
      usableHeightPx: good.viewport.height,
      ids: [],
      unknown: [],
    });
  });

  it('a block of half a million leaves reports its extent without overflowing the call stack', () => {
    const template = capture([
      { id: 'app.s', tag: 'section', xpath: `${MAIN}/section`, rect: [0, 0, 600, 20], text: '' },
      {
        id: 'app.s.0',
        tag: 'span',
        xpath: `${MAIN}/section/span`,
        rect: [0, 0, 100, 20],
        text: 'x',
      },
    ]);
    const leaf = template.items.find((i) => i.id === 'app.s.0')!;
    const n = 500_000;
    const items: DensityItem[] = [template.items.find((i) => i.id === 'app.s')!];
    for (let k = 0; k < n; k++) {
      items.push({ ...leaf, id: `app.s.${k}`, rect: { x: 0, y: 20 * k, w: 100, h: 20 } });
    }
    const big: DensityCapture = { ...template, items };
    const blocks = densityBlocks(big, null);
    const block = blocks.blocks.find((b) => b.by === 'path')!;
    expect([block.members.length, block.topPx, block.heightPx]).toEqual([n, 0, 20 * n]);
  });

  it('a forged member rect handed to blocks is no rect', () => {
    const c = capture([
      { id: 'app.s', tag: 'section', xpath: `${MAIN}/section`, rect: [0, 0, 600, 40], text: '' },
      {
        id: 'app.s.a',
        tag: 'span',
        xpath: `${MAIN}/section/span[1]`,
        rect: [0, 0, 100, 20],
        text: 'a',
      },
      {
        id: 'app.s.b',
        tag: 'span',
        xpath: `${MAIN}/section/span[2]`,
        rect: [0, 20, 100, 20],
        text: 'b',
      },
    ]);
    const forged = {
      ...c,
      items: c.items.map((i) =>
        i.id === 'app.s.b' ? { ...i, rect: { x: 0, y: 1e308, w: 100, h: 1e308 } } : i
      ),
    };
    const block = densityBlocks(forged, null).blocks.find((b) => b.by === 'path')!;
    expect([block.members, block.topPx, block.heightPx]).toEqual([['app.s.a', 'app.s.b'], 0, 20]);
  });
});
