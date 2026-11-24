// @vitest-environment node
/**
 * The follow-ups recorded against density Phases 4, 5 and 6: reach order and
 * the declared `via`, a text matcher's unread items, displacement over no
 * weight, partly drawn text, a centred last row, row-header rows, form
 * columns, pagers in unregistered landmarks and pager grouping, and the
 * affordances of a capture written before the repeat keys existed. Every expected value is a literal; every id and text is
 * synthetic (plan D5).
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (follow-ups of Phases 4-6).
 */
import { describe, expect, it } from 'vitest';
import {
  densityAffordances,
  densityPagerGroups,
  summarizeDensityAffordances,
} from '../affordances';
import { captureDensityFromSnapshot } from '../capture-from-snapshot';
import { measureDensity, type DensityMeasureReport } from '../measure';
import { densityQuantity, densityQuantityValues } from '../quantities';
import { densityRepeats } from '../repeats';
import {
  parseDensityCapture,
  parseDensityTargets,
  type DensityCapture,
  type DensityItem,
  type DensityTargets,
} from '../schema';
import {
  DENSITY_TEST_PRODUCER,
  densityTestSnapshot,
  type DensityTestElementSpec,
  type DensityTestSnapshotSpec,
} from './fixtures/snapshot-builder';

const MAIN = '/html/body/main';

function capture(
  elements: DensityTestElementSpec[],
  targets: DensityTargets | null = null,
  relationships?: DensityTestSnapshotSpec['relationships']
): DensityCapture {
  const obs = captureDensityFromSnapshot(densityTestSnapshot({ elements, relationships }), {
    producer: DENSITY_TEST_PRODUCER,
    role: 'buyer',
    targets,
    evaluatedAt: '2026-11-24T10:00:00.000Z',
  });
  if (obs.status !== 'measured') throw new Error(`expected measured, got ${JSON.stringify(obs)}`);
  return obs.value;
}

function report(c: DensityCapture, targets: DensityTargets | null): DensityMeasureReport {
  const obs = measureDensity(c, {
    producer: DENSITY_TEST_PRODUCER,
    targets,
    evaluatedAt: '2026-11-24T10:00:00.000Z',
  });
  if (obs.status !== 'measured') throw new Error(`expected measured, got ${JSON.stringify(obs)}`);
  return obs.value;
}

function targetsOf(asks: Array<Record<string, unknown>>): DensityTargets {
  const parsed = parseDensityTargets({
    schema: 'ui-bridge/density-targets@1',
    surface: '/',
    profile: 'audience_profile/synthetic@1',
    roles: [
      {
        role: 'buyer',
        asks: asks.map((a) => ({
          question: 'Synthetic?',
          source: { doc: 'audience_profile/synthetic@1', quote: 'Synthetic sentence.' },
          ...a,
        })),
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
  return parsed.value;
}

describe('density follow-ups: reach', () => {
  it('runs with no DOM', () => {
    expect(typeof document).toBe('undefined');
  });

  it('need any: an item known to be readable is reached before one whose availability is unknown', () => {
    const targets = targetsOf([
      { id: 'S1', rank: 1, weight: 1, kind: 'state', answer: { ids: ['app.a', 'app.b'] } },
    ]);
    const els: DensityTestElementSpec[] = [
      // On the first screen, but its visibility is not stated: unknown.
      { id: 'app.a', tag: 'span', xpath: `${MAIN}/span[1]`, rect: [0, 100, 80, 20], text: '1' },
      { id: 'app.b', tag: 'span', xpath: `${MAIN}/span[2]`, rect: [0, 900, 80, 20], text: '2' },
    ];
    els[0] = { ...els[0], visible: null };
    const s1 = report(capture(els, targets), targets).role!.asks[0];
    expect([s1.first!.id, s1.first!.scrollPx, s1.first!.available, s1.available]).toEqual([
      'app.b',
      120,
      true,
      true,
    ]);
  });

  it('need all: an item outside every closed container still walks the declared via', () => {
    const targets = targetsOf([
      {
        id: 'A1',
        rank: 1,
        weight: 1,
        kind: 'state',
        need: 'all',
        via: ['Open the details panel'],
        answer: { ids: ['app.panel.value', 'app.loose'] },
      },
    ]);
    const els: DensityTestElementSpec[] = [
      {
        id: 'app.toggle',
        tag: 'button',
        category: 'interactive',
        xpath: `${MAIN}/button`,
        rect: [0, 100, 120, 28],
        text: 'Details',
        ariaExpanded: false,
      },
      { id: 'app.panel', tag: 'div', xpath: `${MAIN}/div[1]`, rect: [0, 140, 400, 40], text: '7' },
      {
        id: 'app.panel.value',
        tag: 'span',
        xpath: `${MAIN}/div[1]/span`,
        rect: [0, 140, 80, 20],
        text: '7',
      },
      // Hidden, with nothing registered around it that says how it is opened.
      {
        id: 'app.loose',
        tag: 'span',
        xpath: `${MAIN}/span`,
        rect: [0, 200, 80, 20],
        text: '9',
        visible: false,
        visibilityReason: 'hidden',
      },
    ];
    const r = report(
      capture(els, targets, [{ source: 'app.toggle', target: 'app.panel', type: 'controls' }]),
      targets
    );
    const all = r.role!.asks[0].all!;
    // One open of the panel, and the declared via for the item outside it.
    expect([all.interactions, all.actions, all.unknownItems]).toEqual([2, 2, 0]);
  });

  it('a text matcher is partial only when an unread item is one its other fields select', () => {
    const asks = [
      {
        id: 'T1',
        rank: 1,
        weight: 1,
        kind: 'reference',
        answer: { idPrefix: 'app.help.', text: 'Synthetic help' },
      },
    ];
    const targets = targetsOf(asks);
    const help: DensityTestElementSpec = {
      id: 'app.help.text',
      tag: 'p',
      xpath: `${MAIN}/p[1]`,
      rect: [0, 100, 400, 20],
      text: 'Synthetic help',
    };
    const secret = (id: string): DensityTestElementSpec => ({
      id,
      tag: 'span',
      xpath: `${MAIN}/span`,
      rect: [0, 140, 200, 20],
      text: 'Synthetic secret',
      redacted: true,
    });
    const elsewhere = report(capture([help, secret('app.other.secret')], targets), targets);
    const t1 = elsewhere.role!.asks[0];
    expect([t1.state, t1.partial, t1.unresolvedBy, elsewhere.role!.unresolvedWeight]).toEqual([
      'rendered',
      false,
      [],
      0,
    ]);
    const inside = report(capture([help, secret('app.help.secret')], targets), targets);
    const t2 = inside.role!.asks[0];
    expect([t2.state, t2.partial, t2.unresolvedBy, inside.role!.unresolvedWeight]).toEqual([
      'rendered',
      true,
      ['text-unevaluated'],
      1,
    ]);
  });

  it('a role whose asks weigh nothing reports displacementPx null, never 0', () => {
    const targets = targetsOf([]);
    const els: DensityTestElementSpec[] = [
      { id: 'app.s', tag: 'section', xpath: `${MAIN}/section`, rect: [0, 0, 600, 200], text: 'A' },
      { id: 'app.s.p', tag: 'p', xpath: `${MAIN}/section/p`, rect: [0, 0, 600, 20], text: 'A' },
    ];
    const r = report(capture(els, targets), targets);
    expect(r.blocks.list.map((b) => [b.id, b.claimedWeight, b.displacementPx])).toEqual([
      ['path:/html/body/main/section', 0, null],
    ]);
    expect(r.unclaimed!.list).toEqual([]);
  });
});

describe('density follow-ups: the capture', () => {
  it('visible text shorter than the counted text leaves charsDrawn unknown', () => {
    const c = capture([
      // A hidden descendant's text is counted by textContent, not drawn.
      {
        id: 'app.partial',
        tag: 'span',
        xpath: `${MAIN}/span[1]`,
        text: 'Total 7 hidden',
        visibleText: 'Total 7',
        nameSource: 'text',
      },
      // innerText breaks lines where textContent does not: the same text.
      {
        id: 'app.lines',
        tag: 'div',
        xpath: `${MAIN}/div`,
        text: 'ab',
        visibleText: 'a\nb',
        nameSource: 'text',
      },
    ]);
    expect(c.items.map((i) => [i.id, i.chars, i.charsDrawn])).toEqual([
      ['app.partial', 14, null],
      ['app.lines', 2, true],
    ]);
    expect(c.coverage.unmeasured).toEqual([
      { dimension: 'charsDrawn', count: 1, code: 'input_missing' },
    ]);
  });
});

describe('density follow-ups: repeats', () => {
  it('a single card one pitch below a grid but outside its edges is not that grid', () => {
    const els: DensityTestElementSpec[] = [
      { id: 'app.g', tag: 'div', xpath: `${MAIN}/div`, rect: [0, 90, 1400, 400], text: '' },
    ];
    for (let i = 0; i < 9; i++) {
      els.push({
        id: `app.g.${i + 1}`,
        tag: 'div',
        xpath: `${MAIN}/div/div[${i + 1}]`,
        rect: [320 * (i % 3), 100 + 110 * Math.floor(i / 3), 300, 100],
        text: `Card ${i + 1}`,
      });
    }
    // One pitch below the last row, to the right of the grid's right edge (940).
    els.push({
      id: 'app.g.10',
      tag: 'div',
      xpath: `${MAIN}/div/div[10]`,
      rect: [1000, 430, 300, 100],
      text: 'Card 10',
    });
    const reps = densityRepeats(capture(els), null);
    expect(reps.map((r) => [r.id, r.rows, r.perRow, r.members.length])).toEqual([
      ['repeat:app.g.1', 3, 3, 9],
    ]);
  });

  it('a row-header-only row after a data row is a data row; a leading all-th row is the header', () => {
    const T = `${MAIN}/table/tbody`;
    const cells: DensityTestElementSpec[] = [1, 2].map((j) => ({
      id: `app.t.h${j}`,
      tag: 'th',
      xpath: `${T}/tr[1]/th[${j}]`,
      rect: [300 * (j - 1), 100, 300, 32],
      text: `Column ${j}`,
    }));
    for (let k = 2; k <= 4; k++) {
      cells.push({
        id: `app.t.r${k}h`,
        tag: 'th',
        xpath: `${T}/tr[${k}]/th`,
        rect: [0, 132 + 40 * (k - 2), 300, 40],
        text: `Row ${k}`,
      });
      // Row 3 registers only its row header.
      if (k !== 3) {
        cells.push({
          id: `app.t.r${k}d`,
          tag: 'td',
          xpath: `${T}/tr[${k}]/td`,
          rect: [300, 132 + 40 * (k - 2), 300, 40],
          text: `Value ${k}`,
        });
      }
    }
    const reps = densityRepeats(capture(cells), null);
    expect(reps.map((r) => [r.id, r.rows, r.members.length, r.firstRow])).toEqual([
      ['repeat:app.t.r2h', 3, 5, { topPx: 132, bottomPx: 172 }],
    ]);
  });

  it('a column of bare checkboxes is a form, not a repeat; a checkbox beside a span is a row', () => {
    const row = (k: number, withText: boolean): DensityTestElementSpec[] => [
      {
        id: `app.c.${k}`,
        tag: 'div',
        xpath: `${MAIN}/div/div[${k}]`,
        rect: [0, 100 + 32 * (k - 1), 300, 28],
        text: withText ? `Task ${k}` : '',
      },
      {
        id: `app.c.${k}.box`,
        tag: 'input',
        role: 'checkbox',
        category: 'interactive',
        xpath: `${MAIN}/div/div[${k}]/input`,
        rect: [0, 104 + 32 * (k - 1), 20, 20],
        text: '',
      },
      ...(withText
        ? [
            {
              id: `app.c.${k}.text`,
              tag: 'span',
              xpath: `${MAIN}/div/div[${k}]/span`,
              rect: [28, 104 + 32 * (k - 1), 200, 20],
              text: `Task ${k}`,
            } as DensityTestElementSpec,
          ]
        : []),
    ];
    const bare = [1, 2, 3].flatMap((k) => row(k, false));
    expect(densityRepeats(capture(bare), null).map((r) => r.id)).toEqual([]);
    const todo = [1, 2, 3].flatMap((k) => row(k, true));
    expect(densityRepeats(capture(todo), null).map((r) => [r.id, r.rows])).toEqual([
      ['repeat:app.c.1', 3],
    ]);
  });

  it('four stacked containers with one odd width are layout; five keep the odd row', () => {
    // Containers (each holds a registered line), so the all-leaves arm does not apply.
    const column = (n: number): DensityTestElementSpec[] =>
      Array.from({ length: n }, (_, i): DensityTestElementSpec[] => [
        {
          id: `app.o.${i + 1}`,
          tag: 'div',
          xpath: `${MAIN}/div/div[${i + 1}]`,
          rect: [0, 100 + 60 * i, i === 1 ? 700 : 600, 50],
          text: `Item ${i + 1}`,
        },
        {
          id: `app.o.${i + 1}.line`,
          tag: 'span',
          xpath: `${MAIN}/div/div[${i + 1}]/span`,
          rect: [0, 100 + 60 * i, 200, 20],
          text: `Item ${i + 1}`,
        },
      ]).flat();
    expect(densityRepeats(capture(column(4)), null).map((r) => r.id)).toEqual([]);
    expect(densityRepeats(capture(column(5)), null).map((r) => [r.id, r.rows])).toEqual([
      ['repeat:app.o.1', 5],
    ]);
  });
});

describe('density follow-ups: pagers', () => {
  /** Three rows in a section, and two buttons below them in navigation landmarks nobody registered. */
  function unregisteredNavs(): DensityTestElementSpec[] {
    const S = `${MAIN}/section`;
    const els: DensityTestElementSpec[] = [
      { id: 'app.s', tag: 'section', xpath: S, rect: [0, 100, 600, 300], text: '' },
    ];
    for (let k = 1; k <= 3; k++) {
      els.push({
        id: `app.s.row-${k}`,
        tag: 'li',
        xpath: `${S}/ul/li[${k}]`,
        rect: [0, 100 + 40 * (k - 1), 600, 36],
        text: `Row ${k}`,
      });
    }
    for (const [k, x] of [
      [1, 0],
      [2, 300],
    ] as const) {
      els.push({
        id: `app.s.page-${k}`,
        tag: 'button',
        category: 'interactive',
        xpath: `${S}/div[${k}]/button`,
        semanticPath: `section > div[role="navigation"] > button`,
        rect: [x, 240, 80, 28],
        text: `Page ${k}`,
      });
    }
    return els;
  }

  it('controls in navigation landmarks nobody registered are one pager each', () => {
    const pagers = densityAffordances(capture(unregisteredNavs()), null).filter(
      (a) => a.kind === 'pager'
    );
    expect(pagers.map((a) => [a.id, a.rule, a.members])).toEqual([
      ['app.s.page-1', 'nav-after-repeat', ['app.s.page-1']],
      ['app.s.page-2', 'nav-after-repeat', ['app.s.page-2']],
    ]);
  });

  it('pager groups do not depend on the order of the controls', () => {
    const item = (id: string): DensityItem => ({ id }) as unknown as DensityItem;
    const first = { key: 'key:/html/body/main/nav[1]', item: item('first') };
    const second = { key: 'key:/html/body/main/nav[2]', item: item('second') };
    // Spells both sibling navs: it cannot say which it is in.
    const anchored = { key: 'tags:html/body/main/nav', item: item('anchored') };
    const ids = (groups: DensityItem[][]) => groups.map((g) => g.map((i) => i.id));
    expect(ids(densityPagerGroups([anchored, first, second]))).toEqual([
      ['anchored'],
      ['first'],
      ['second'],
    ]);
    expect(ids(densityPagerGroups([first, second, anchored]))).toEqual([
      ['first'],
      ['second'],
      ['anchored'],
    ]);
    // Spelling one keyed nav only, it joins that nav, before or after it.
    expect(ids(densityPagerGroups([anchored, first]))).toEqual([['anchored', 'first']]);
    expect(ids(densityPagerGroups([first, anchored]))).toEqual([['first', 'anchored']]);
  });
});

describe('density follow-ups: a capture written before the repeat keys existed', () => {
  function oldCapture(): DensityCapture {
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
    return parsed.value;
  }

  it('the filter and pager rules read null, never 0, and a passed list is honoured', () => {
    const c = oldCapture();
    const passed = densityAffordances(c, null, { repeats: [] }).filter((a) => a.kind === 'tab');
    const s = summarizeDensityAffordances(c, null, passed);
    expect([s.structureResolved && s.byRule, s.structureResolved && s.total]).toEqual([
      {
        'declared-filters': null,
        'declared-controls': null,
        'control-above-repeat': null,
        'nav-after-repeat': null,
        'role-tab': 1,
      },
      1,
    ]);
  });

  it('measure reports its item-local affordances, and their total as a lower bound', () => {
    const r = report(oldCapture(), null);
    expect(r.affordances).toMatchObject({
      repeatKeysResolved: false,
      byKind: { tab: 1, search: 1, filter: null, pager: null },
      total: 2,
    });
    const total = densityQuantityValues(r, densityQuantity('cell.affordances')!);
    expect(total.map((v) => v.value)).toEqual([{ lo: 2, hi: null }]);
  });
});
