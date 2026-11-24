// @vitest-environment node
/**
 * affordances.ts over a hand-built snapshot (design test 1, continued):
 * literal expected affordances, each with the rule that detected it.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 4).
 */
import { describe, expect, it } from 'vitest';
import { densityAffordances, summarizeDensityAffordances } from '../affordances';
import { captureDensityFromSnapshot } from '../capture-from-snapshot';
import { densityRepeats } from '../repeats';
import type { DensityCapture } from '../schema';
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

const HIDES = {
  unknown: 'input_missing',
  reason:
    'what a control hides is measured by the document walk; a snapshot of registered elements does not carry it',
};

const SECTION = '/html/body/main/section';
const ASIDE = '/html/body/main/aside';

/** A list section with a filter above it, a select below it and a pager after it; an aside with the rest. */
const PAGE: DensityTestElementSpec[] = [
  { id: 'app.orders', tag: 'section', xpath: SECTION, rect: [0, 100, 600, 500], text: '' },
  {
    id: 'app.orders.title',
    tag: 'h2',
    xpath: `${SECTION}/h2`,
    rect: [0, 100, 300, 28],
    text: 'Orders',
  },
  {
    id: 'app.orders.state',
    tag: 'select',
    role: 'combobox',
    category: 'interactive',
    xpath: `${SECTION}/select`,
    rect: [400, 100, 200, 28],
    text: 'All states',
  },
  { id: 'app.orders.list', tag: 'ul', xpath: `${SECTION}/ul`, rect: [0, 140, 600, 196], text: '' },
  ...[1, 2, 3, 4, 5].map(
    (k): DensityTestElementSpec => ({
      id: `app.orders.row-${k}`,
      tag: 'li',
      xpath: `${SECTION}/ul/li[${k}]`,
      rect: [0, 140 + 40 * (k - 1), 600, 36],
      text: `Order ${k}`,
    })
  ),
  // Below the list's first row: not a filter.
  {
    id: 'app.orders.export',
    tag: 'select',
    role: 'combobox',
    category: 'interactive',
    xpath: `${SECTION}/div/select`,
    rect: [0, 350, 200, 28],
    text: 'Export as',
  },
  {
    id: 'app.orders.prev',
    tag: 'button',
    category: 'interactive',
    xpath: `${SECTION}/nav/button[1]`,
    rect: [0, 390, 80, 28],
    text: 'Previous',
  },
  {
    id: 'app.orders.next',
    tag: 'button',
    category: 'interactive',
    xpath: `${SECTION}/nav/button[2]`,
    rect: [100, 390, 80, 28],
    text: 'Next',
  },
  { id: 'app.side', tag: 'aside', xpath: ASIDE, rect: [700, 100, 400, 500], text: '' },
  // Above the list's first row, but in another block: not a filter.
  {
    id: 'app.side.sort',
    tag: 'select',
    role: 'combobox',
    category: 'interactive',
    xpath: `${ASIDE}/select`,
    rect: [700, 100, 200, 28],
    text: 'Newest',
  },
  {
    id: 'app.side.search',
    tag: 'input',
    role: 'searchbox',
    category: 'interactive',
    xpath: `${ASIDE}/input`,
    rect: [700, 140, 200, 28],
    text: '',
  },
  {
    id: 'app.side.more',
    tag: 'button',
    category: 'interactive',
    xpath: `${ASIDE}/button`,
    rect: [700, 180, 120, 28],
    text: 'More filters',
    ariaExpanded: false,
  },
  {
    id: 'app.side.panel',
    tag: 'div',
    xpath: `${ASIDE}/div[1]`,
    rect: [700, 210, 400, 10],
    text: '',
  },
  {
    id: 'app.side.help',
    tag: 'summary',
    xpath: `${ASIDE}/details/summary`,
    rect: [700, 230, 200, 20],
    text: 'Help',
    ariaExpanded: true,
  },
  {
    id: 'app.side.tab-1',
    tag: 'button',
    role: 'tab',
    category: 'interactive',
    xpath: `${ASIDE}/div[2]/button[1]`,
    rect: [700, 260, 90, 28],
    text: 'Open',
    ariaSelected: true,
  },
  {
    id: 'app.side.tab-2',
    tag: 'button',
    role: 'tab',
    category: 'interactive',
    xpath: `${ASIDE}/div[2]/button[2]`,
    rect: [800, 260, 90, 28],
    text: 'Closed',
    ariaSelected: false,
  },
  {
    id: 'app.side.cell-1',
    tag: 'span',
    xpath: `${ASIDE}/span[1]`,
    rect: [700, 300, 100, 20],
    text: 'Synthetic long customer name',
    scrollWidth: 300,
    clientWidth: 100,
    styles: { overflow: 'hidden' },
  },
  {
    id: 'app.side.cell-2',
    tag: 'span',
    xpath: `${ASIDE}/span[2]`,
    rect: [700, 330, 100, 20],
    text: 'Synthetic long street name',
    scrollWidth: 300,
    clientWidth: 100,
    styles: { overflow: 'hidden' },
    nameSource: 'title',
  },
];

const RELATIONSHIPS = [
  { source: 'app.side.more', target: 'app.side.panel', type: 'controls' as const },
];

describe('affordances', () => {
  it('runs with no DOM', () => {
    expect(typeof document).toBe('undefined');
  });

  it('each affordance is listed with the rule that detected it', () => {
    const c = capture(PAGE, RELATIONSHIPS);
    expect(densityAffordances(c, null)).toEqual([
      {
        kind: 'search',
        rule: 'role-searchbox',
        id: 'app.side.search',
        state: null,
        controls: null,
        repeat: null,
        recoverable: null,
        hides: HIDES,
      },
      {
        kind: 'disclosure',
        rule: 'aria-expanded',
        id: 'app.side.more',
        state: 'closed',
        controls: 'app.side.panel',
        repeat: null,
        recoverable: null,
        hides: HIDES,
      },
      {
        kind: 'disclosure',
        rule: 'summary',
        id: 'app.side.help',
        state: 'open',
        controls: null,
        repeat: null,
        recoverable: null,
        hides: HIDES,
      },
      {
        kind: 'tab',
        rule: 'role-tab',
        id: 'app.side.tab-1',
        state: 'active',
        controls: null,
        repeat: null,
        recoverable: null,
        hides: HIDES,
      },
      {
        kind: 'tab',
        rule: 'role-tab',
        id: 'app.side.tab-2',
        state: 'inactive',
        controls: null,
        repeat: null,
        recoverable: null,
        hides: HIDES,
      },
      {
        kind: 'truncation',
        rule: 'scroll-width',
        id: 'app.side.cell-1',
        state: null,
        controls: null,
        repeat: null,
        recoverable: null,
        hides: HIDES,
      },
      {
        kind: 'truncation',
        rule: 'scroll-width',
        id: 'app.side.cell-2',
        state: null,
        controls: null,
        repeat: null,
        recoverable: true,
        hides: HIDES,
      },
      {
        kind: 'abbreviation',
        rule: 'title',
        id: 'app.side.cell-2',
        state: null,
        controls: null,
        repeat: null,
        recoverable: true,
        hides: HIDES,
      },
      {
        kind: 'filter',
        rule: 'control-above-repeat',
        id: 'app.orders.state',
        state: null,
        controls: null,
        repeat: 'repeat:app.orders.row-1',
        recoverable: null,
        hides: HIDES,
      },
      {
        kind: 'pager',
        rule: 'nav-after-repeat',
        id: 'app.orders.prev',
        state: null,
        controls: null,
        repeat: 'repeat:app.orders.row-1',
        recoverable: null,
        hides: HIDES,
      },
      {
        kind: 'pager',
        rule: 'nav-after-repeat',
        id: 'app.orders.next',
        state: null,
        controls: null,
        repeat: 'repeat:app.orders.row-1',
        recoverable: null,
        hides: HIDES,
      },
    ]);
  });

  it('the list finds its finder above its first row, never a control below it or in another block', () => {
    const [rep] = densityRepeats(capture(PAGE, RELATIONSHIPS), null);
    expect([rep.id, rep.rows, rep.scope, rep.finder]).toEqual([
      'repeat:app.orders.row-1',
      5,
      'block',
      { id: 'app.orders.state', by: 'position' },
    ]);
  });

  it('a declared filters edge makes a select a filter wherever it sits, and a search box the finder', () => {
    const c = capture(PAGE, [
      ...RELATIONSHIPS,
      { source: 'app.side.sort', target: 'app.orders.list', type: 'filters' },
      { source: 'app.side.search', target: 'app.orders.list', type: 'filters' },
    ]);
    const filters = densityAffordances(c, null).filter((a) => a.kind === 'filter');
    // The search box is the finder and a search, never also a filter.
    expect(filters.map((a) => [a.id, a.rule, a.repeat])).toEqual([
      ['app.orders.state', 'control-above-repeat', 'repeat:app.orders.row-1'],
      ['app.side.sort', 'declared-filters', 'repeat:app.orders.row-1'],
    ]);
    // Both carry the edge; a search box outranks a select as the finder.
    expect(densityRepeats(c, null)[0].finder).toEqual({
      id: 'app.side.search',
      by: 'relationship',
    });
  });

  it('a table whose rows open its own block still finds the search, filter and pager beside it', () => {
    const S = '/html/body/main/section';
    const els: DensityTestElementSpec[] = [
      { id: 'app.t', tag: 'section', xpath: S, rect: [0, 100, 800, 600], text: '' },
      {
        id: 'app.t.q',
        tag: 'input',
        role: 'searchbox',
        category: 'interactive',
        xpath: `${S}/input`,
        rect: [0, 100, 300, 28],
        text: '',
      },
      {
        id: 'app.t.state',
        tag: 'select',
        role: 'combobox',
        category: 'interactive',
        xpath: `${S}/select`,
        rect: [400, 100, 200, 28],
        text: 'All',
      },
      { id: 'app.t.table', tag: 'table', xpath: `${S}/table`, rect: [0, 140, 800, 120], text: '' },
      ...[1, 2, 3].flatMap((k): DensityTestElementSpec[] => [
        {
          id: `app.t.row-${k}`,
          tag: 'tr',
          xpath: `${S}/table/tbody/tr[${k}]`,
          rect: [0, 140 + 40 * (k - 1), 800, 40],
          text: `R${k} 12,50 €`,
        },
        {
          id: `app.t.row-${k}.a`,
          tag: 'td',
          xpath: `${S}/table/tbody/tr[${k}]/td[1]`,
          rect: [0, 140 + 40 * (k - 1), 400, 40],
          text: `R${k}`,
        },
        {
          id: `app.t.row-${k}.b`,
          tag: 'td',
          xpath: `${S}/table/tbody/tr[${k}]/td[2]`,
          rect: [400, 140 + 40 * (k - 1), 400, 40],
          text: '12,50 €',
        },
      ]),
      {
        id: 'app.t.next',
        tag: 'button',
        category: 'interactive',
        xpath: `${S}/nav/button`,
        rect: [0, 280, 80, 28],
        text: 'Next',
      },
    ];
    const c = capture(els);
    const [rep] = densityRepeats(c, null);
    expect([rep.id, rep.scope, rep.finder]).toEqual([
      'repeat:app.t.row-1',
      'ancestor',
      // Both sit at one height above the first row; the earlier in capture order wins.
      { id: 'app.t.q', by: 'position' },
    ]);
    const acting = densityAffordances(c, null, { repeats: [rep] }).filter((a) => a.repeat !== null);
    expect(acting.map((a) => [a.id, a.rule])).toEqual([
      ['app.t.state', 'control-above-repeat'],
      ['app.t.next', 'nav-after-repeat'],
    ]);
  });

  it('an icon button named by its title is not an abbreviation; a hidden select is not a filter', () => {
    const els = PAGE.map((e): DensityTestElementSpec => {
      if (e.id === 'app.side.more') return { ...e, text: '', nameSource: 'title' };
      if (e.id === 'app.side.sort') return { ...e, visible: false, visibilityReason: 'hidden' };
      return e;
    });
    const c = capture(els, [
      ...RELATIONSHIPS,
      { source: 'app.side.sort', target: 'app.orders.list', type: 'filters' },
    ]);
    const found = densityAffordances(c, null);
    expect(found.filter((a) => a.kind === 'abbreviation').map((a) => a.id)).toEqual([
      'app.side.cell-2',
    ]);
    expect(found.filter((a) => a.kind === 'filter').map((a) => a.id)).toEqual(['app.orders.state']);
  });

  it('a pager of links in unregistered list items is found; a combobox is no disclosure', () => {
    const els = PAGE.filter((e) => e.id !== 'app.orders.prev' && e.id !== 'app.orders.next')
      .map(
        (e): DensityTestElementSpec =>
          e.id === 'app.orders.state' ? { ...e, ariaExpanded: false } : e
      )
      .concat(
        [1, 2, 3, 4].map(
          (k): DensityTestElementSpec => ({
            id: `app.pg.${k}`,
            tag: 'a',
            category: 'interactive',
            xpath: `${SECTION}/nav/ul/li[${k}]/a`,
            rect: [40 * (k - 1), 390, 32, 28],
            text: `${k}`,
          })
        )
      );
    const c = capture(els, RELATIONSHIPS);
    expect(densityRepeats(c, null).map((r) => r.id)).toEqual(['repeat:app.orders.row-1']);
    const found = densityAffordances(c, null);
    expect(found.filter((a) => a.kind === 'pager').map((a) => a.id)).toEqual([
      'app.pg.1',
      'app.pg.2',
      'app.pg.3',
      'app.pg.4',
    ]);
    expect(found.filter((a) => a.kind === 'disclosure').map((a) => a.id)).toEqual([
      'app.side.more',
      'app.side.help',
    ]);
  });

  it('a list in unregistered items inside each registered row stays; an edge to it is its filter only', () => {
    const S = '/html/body/main/section';
    const els: DensityTestElementSpec[] = [
      { id: 'g', tag: 'section', xpath: S, rect: [0, 0, 800, 700], text: '' },
      {
        id: 'g.sel',
        tag: 'select',
        role: 'combobox',
        category: 'interactive',
        xpath: `${S}/select`,
        rect: [0, 10, 200, 28],
        text: 'All',
      },
      { id: 'g.list', tag: 'ul', xpath: `${S}/ul`, rect: [0, 50, 800, 600], text: '' },
    ];
    for (let k = 1; k <= 3; k++) {
      const y = 50 + 200 * (k - 1);
      els.push({
        id: `g.c${k}`,
        tag: 'li',
        xpath: `${S}/ul/li[${k}]`,
        rect: [0, y, 800, 180],
        text: `Group ${k} A B C`,
      });
      for (let j = 1; j <= 3; j++) {
        els.push({
          id: `g.c${k}.l${j}`,
          tag: 'a',
          category: 'interactive',
          xpath: `${S}/ul/li[${k}]/ul/li[${j}]/a`,
          rect: [20, y + 40 + 40 * (j - 1), 200, 30],
          text: 'ABC'[j - 1],
        });
      }
    }
    const c = capture(els, [{ source: 'g.sel', target: 'g.c2.l1', type: 'filters' }]);
    const reps = densityRepeats(c, null);
    expect(reps.map((r) => [r.id, r.rows])).toEqual([
      ['repeat:g.c1', 3],
      ['repeat:g.c1.l1', 3],
      ['repeat:g.c2.l1', 3],
      ['repeat:g.c3.l1', 3],
    ]);
    const filters = densityAffordances(c, null, { repeats: reps }).filter(
      (a) => a.rule === 'declared-filters'
    );
    expect(filters.map((a) => [a.id, a.repeat])).toEqual([['g.sel', 'repeat:g.c2.l1']]);
  });

  it('a select-all checkbox in a table header is not a filter', () => {
    const S = '/html/body/main/section';
    const els: DensityTestElementSpec[] = [
      { id: 't', tag: 'section', xpath: S, rect: [0, 0, 800, 400], text: '' },
      { id: 't.table', tag: 'table', xpath: `${S}/table`, rect: [0, 0, 800, 200], text: '' },
      {
        id: 't.all',
        tag: 'input',
        role: 'checkbox',
        category: 'interactive',
        xpath: `${S}/table/thead/tr/th/input`,
        rect: [0, 10, 20, 20],
        text: '',
      },
      ...[1, 2, 3].map(
        (k): DensityTestElementSpec => ({
          id: `t.r${k}`,
          tag: 'tr',
          xpath: `${S}/table/tbody/tr[${k}]`,
          rect: [0, 40 * k, 800, 40],
          text: `Row ${k}`,
        })
      ),
    ];
    const found = densityAffordances(capture(els), null);
    expect(found.filter((a) => a.kind === 'filter')).toEqual([]);
  });

  it('a sort button in the table header does not stop the scope at the table', () => {
    const S = '/html/body/main/section';
    const els: DensityTestElementSpec[] = [
      { id: 'app.t', tag: 'section', xpath: S, rect: [0, 100, 800, 600], text: '' },
      {
        id: 'app.t.state',
        tag: 'select',
        role: 'combobox',
        category: 'interactive',
        xpath: `${S}/select`,
        rect: [0, 100, 200, 28],
        text: 'All',
      },
      { id: 'app.t.table', tag: 'table', xpath: `${S}/table`, rect: [0, 140, 800, 160], text: '' },
      {
        id: 'app.t.sort',
        tag: 'button',
        category: 'interactive',
        xpath: `${S}/table/thead/tr/th/button`,
        rect: [0, 140, 80, 40],
        text: 'Sort',
      },
      ...[1, 2, 3].map(
        (k): DensityTestElementSpec => ({
          id: `app.t.row-${k}`,
          tag: 'tr',
          xpath: `${S}/table/tbody/tr[${k}]`,
          rect: [0, 180 + 40 * (k - 1), 800, 40],
          text: `Row ${k}`,
        })
      ),
    ];
    const [rep] = densityRepeats(capture(els), null);
    expect([rep.scope, rep.finder]).toEqual(['ancestor', { id: 'app.t.state', by: 'position' }]);
  });

  it('a pager more than a screen below the last row is not the pager of the list', () => {
    const els = PAGE.map((e) =>
      e.id === 'app.orders.next'
        ? { ...e, rect: [100, 1200, 80, 28] as [number, number, number, number] }
        : e
    );
    const pagers = densityAffordances(capture(els, RELATIONSHIPS), null).filter(
      (a) => a.kind === 'pager'
    );
    expect(pagers.map((a) => a.id)).toEqual(['app.orders.prev']);
  });

  it('a select with a declared controls edge to the list is a filter by that edge', () => {
    const c = capture(PAGE, [
      ...RELATIONSHIPS,
      { source: 'app.side.sort', target: 'app.orders.list', type: 'controls' },
    ]);
    const filters = densityAffordances(c, null).filter((a) => a.kind === 'filter');
    expect(filters.map((a) => [a.id, a.rule])).toEqual([
      ['app.orders.state', 'control-above-repeat'],
      ['app.side.sort', 'declared-controls'],
    ]);
  });

  it('a disclosure with no aria-expanded and no summary is not one; a summary with no state is', () => {
    const els = PAGE.map((e) => {
      if (e.id === 'app.side.more') return { ...e, ariaExpanded: undefined };
      if (e.id === 'app.side.help') return { ...e, ariaExpanded: undefined };
      return e;
    });
    const disclosures = densityAffordances(capture(els), null).filter(
      (a) => a.kind === 'disclosure'
    );
    expect(disclosures.map((a) => [a.id, a.rule, a.state])).toEqual([
      ['app.side.help', 'summary', null],
    ]);
  });

  it('a menu reads open or closed from its visibility, and its item from the menu', () => {
    const els: DensityTestElementSpec[] = [
      {
        id: 'app.menu',
        tag: 'ul',
        role: 'menu',
        xpath: '/html/body/ul',
        rect: [0, 0, 200, 100],
        text: '',
        visible: false,
        visibilityReason: 'hidden',
      },
      {
        id: 'app.menu.item',
        tag: 'li',
        role: 'menuitem',
        category: 'interactive',
        xpath: '/html/body/ul/li',
        rect: [0, 0, 200, 20],
        text: 'Rename',
      },
    ];
    expect(densityAffordances(capture(els), null).map((a) => [a.id, a.rule, a.state])).toEqual([
      ['app.menu', 'role-menu', 'closed'],
      ['app.menu.item', 'role-menuitem', 'closed'],
    ]);
    // A menu item in no registered menu: its menu's state is unknown.
    const lone = densityAffordances(capture([{ ...els[1], xpath: '/html/body/li' }]), null);
    expect(lone.map((a) => [a.id, a.rule, a.state])).toEqual([
      ['app.menu.item', 'role-menuitem', null],
    ]);
  });

  it('the finder is the control nearest above the first row, not the topmost', () => {
    const els: DensityTestElementSpec[] = [
      {
        id: 'app.page-sort',
        tag: 'select',
        role: 'combobox',
        category: 'interactive',
        xpath: `${SECTION}/select[2]`,
        rect: [0, 60, 300, 28],
        text: 'Newest',
      },
      ...PAGE.filter((e) => e.xpath!.startsWith(SECTION)),
    ];
    const [rep] = densityRepeats(capture(els), null);
    expect(rep.finder).toEqual({ id: 'app.orders.state', by: 'position' });
  });

  it('a search box above the list outranks a nearer select as its finder', () => {
    const els: DensityTestElementSpec[] = [
      {
        id: 'app.page-search',
        tag: 'input',
        role: 'searchbox',
        category: 'interactive',
        xpath: `${SECTION}/input`,
        rect: [0, 60, 300, 28],
        text: '',
      },
      ...PAGE.filter((e) => e.xpath!.startsWith(SECTION)),
    ];
    const [rep] = densityRepeats(capture(els), null);
    expect(rep.finder).toEqual({ id: 'app.page-search', by: 'position' });
  });

  it("a control inside another repeat's rows is not this repeat's filter", () => {
    // A list above the orders list, each row holding a checkbox, in the same section.
    const pick: DensityTestElementSpec[] = [];
    for (let k = 1; k <= 3; k++) {
      const y = 20 + 24 * (k - 1);
      pick.push(
        {
          id: `app.picks.row-${k}`,
          tag: 'div',
          xpath: `${SECTION}/div[${k + 1}]`,
          rect: [0, y, 300, 20],
          text: `Pick ${k}`,
        },
        {
          id: `app.picks.row-${k}.box`,
          tag: 'input',
          role: 'checkbox',
          category: 'interactive',
          xpath: `${SECTION}/div[${k + 1}]/input`,
          rect: [0, y, 20, 20],
          text: '',
        }
      );
    }
    const c = capture([...PAGE, ...pick], RELATIONSHIPS);
    const reps = densityRepeats(c, null);
    expect(reps.map((r) => r.id)).toEqual(['repeat:app.picks.row-1', 'repeat:app.orders.row-1']);
    const filters = densityAffordances(c, null, { repeats: reps }).filter(
      (a) => a.kind === 'filter'
    );
    expect(filters.map((a) => [a.id, a.repeat])).toEqual([
      ['app.orders.state', 'repeat:app.orders.row-1'],
    ]);
    // The pager below both lists is the nearer list's only.
    const pagers = densityAffordances(c, null, { repeats: reps }).filter((a) => a.kind === 'pager');
    expect(pagers.map((a) => [a.id, a.repeat])).toEqual([
      ['app.orders.prev', 'repeat:app.orders.row-1'],
      ['app.orders.next', 'repeat:app.orders.row-1'],
    ]);
  });

  it('the summary counts by kind and rule, states the static basis, and caps the list', () => {
    const report = summarizeDensityAffordances(capture(PAGE, RELATIONSHIPS), null, undefined, 2);
    expect(report).toMatchObject({
      structureResolved: true,
      interactionsBasis: 'static',
      byKind: {
        disclosure: 2,
        tab: 2,
        menu: 0,
        search: 1,
        filter: 1,
        pager: 2,
        truncation: 2,
        abbreviation: 1,
      },
      byRule: {
        'role-searchbox': 1,
        'aria-expanded': 1,
        summary: 1,
        'role-tab': 2,
        'scroll-width': 2,
        title: 1,
        'control-above-repeat': 1,
        'nav-after-repeat': 2,
      },
      shown: 2,
      total: 11,
      truncated: true,
    });
  });
});
