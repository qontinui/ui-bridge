// @vitest-environment node
/**
 * structure.ts and classify.ts over hand-built snapshots (design test 1):
 * literal expected parents, paths, leaves, pins, kinds and blocks.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 3).
 */
import { describe, expect, it } from 'vitest';
import { captureDensityFromSnapshot } from '../capture-from-snapshot';
import { classifyDensityItems, summarizeDensityStructure } from '../classify';
import { resolveDensityMatcher } from '../match';
import {
  parseDensityCapture,
  parseDensityTargets,
  type DensityCapture,
  type DensityTargets,
} from '../schema';
import { densityBlocks, densityLeaves, densityPins } from '../structure';
import {
  DENSITY_TEST_PRODUCER,
  densityTestSnapshot,
  type DensityTestElementSpec,
} from './fixtures/snapshot-builder';

function capture(elements: DensityTestElementSpec[], targets?: DensityTargets): DensityCapture {
  const obs = captureDensityFromSnapshot(densityTestSnapshot({ elements }), {
    producer: DENSITY_TEST_PRODUCER,
    evaluatedAt: '2026-11-23T10:00:00.000Z',
    targets,
  });
  if (obs.status !== 'measured') throw new Error(`expected measured, got ${JSON.stringify(obs)}`);
  return obs.value;
}

function targets(doc: Record<string, unknown>): DensityTargets {
  const parsed = parseDensityTargets({
    schema: 'ui-bridge/density-targets@1',
    surface: '/',
    profile: 'audience_profile/synthetic@1',
    roles: [],
    ...doc,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
  return parsed.value;
}

const ORDERS = '/section[@data-testid="orders"]';
const HELP = '/html/body/main/div';

/** A synthetic page at 1280x800, unscrolled. */
const PAGE: DensityTestElementSpec[] = [
  // A pinned header: fixed, full width.
  {
    id: 'app.header',
    tag: 'header',
    xpath: '/html/body/header',
    rect: [0, 0, 1280, 48],
    styles: { position: 'fixed' },
    text: 'Synthetic Shop Cart',
  },
  {
    id: 'app.header.title',
    tag: 'span',
    xpath: '/html/body/header/span',
    rect: [16, 12, 200, 24],
    text: 'Synthetic Shop',
  },
  {
    id: 'app.header.cart',
    tag: 'button',
    category: 'interactive',
    xpath: '/html/body/header/button',
    rect: [1180, 8, 80, 32],
    text: 'Cart',
  },
  // A section anchored at a data-testid, holding a heading and a row container
  // with four registered spans.
  {
    id: 'app.orders',
    tag: 'section',
    xpath: ORDERS,
    testId: 'orders',
    rect: [16, 64, 600, 400],
    text: 'Open orders A-1001 Pending 12,50 € 16.10.2026',
  },
  {
    id: 'app.orders.title',
    tag: 'h2',
    xpath: `${ORDERS}/h2`,
    rect: [16, 64, 600, 28],
    text: 'Open orders',
  },
  {
    id: 'app.orders.row-1',
    tag: 'div',
    xpath: `${ORDERS}/div`,
    rect: [16, 100, 600, 20],
    text: 'A-1001 Pending 12,50 € 16.10.2026',
  },
  {
    id: 'app.orders.row-1.no',
    tag: 'span',
    xpath: `${ORDERS}/div/span[1]`,
    rect: [16, 100, 80, 20],
    text: 'A-1001',
  },
  {
    id: 'app.orders.row-1.state',
    tag: 'span',
    xpath: `${ORDERS}/div/span[2]`,
    rect: [100, 100, 80, 20],
    text: 'Pending',
  },
  {
    id: 'app.orders.row-1.sum',
    tag: 'span',
    xpath: `${ORDERS}/div/span[3]`,
    rect: [184, 100, 80, 20],
    text: '12,50 €',
  },
  {
    id: 'app.orders.row-1.due',
    tag: 'span',
    xpath: `${ORDERS}/div/span[4]`,
    rect: [268, 100, 100, 20],
    text: '16.10.2026',
  },
  // An item anchored at its own id, and a child whose chain starts there.
  {
    id: 'app.total',
    tag: 'span',
    xpath: '//*[@id="total"]',
    htmlId: 'total',
    rect: [700, 64, 200, 20],
    text: 'Total 99',
    dataset: { uiBridgeContent: 'app.total' },
  },
  {
    id: 'app.total.amount',
    tag: 'b',
    xpath: '/span[@id="total"]/b',
    rect: [750, 64, 50, 20],
    text: '99',
  },
  // Two headings of different levels in one column, then a third.
  {
    id: 'app.help.title',
    tag: 'h2',
    xpath: `${HELP}/h2[1]`,
    rect: [700, 200, 400, 28],
    text: 'Help',
  },
  {
    id: 'app.help.intro',
    tag: 'p',
    xpath: `${HELP}/p[1]`,
    rect: [700, 232, 400, 20],
    text: 'Synthetic help text',
  },
  {
    id: 'app.help.ship',
    tag: 'h3',
    xpath: `${HELP}/h3`,
    rect: [700, 260, 400, 24],
    text: 'Shipping',
  },
  {
    id: 'app.help.ship-text',
    tag: 'p',
    xpath: `${HELP}/p[2]`,
    rect: [700, 288, 400, 20],
    text: 'Synthetic shipping text',
  },
  {
    id: 'app.faq.title',
    tag: 'h2',
    xpath: `${HELP}/h2[2]`,
    rect: [700, 320, 400, 28],
    text: 'FAQ',
  },
  {
    id: 'app.faq.text',
    tag: 'p',
    xpath: `${HELP}/p[3]`,
    rect: [700, 352, 400, 20],
    text: 'Synthetic answer',
  },
  // A section that a targets file declares as a block.
  {
    id: 'app.company.card',
    tag: 'section',
    xpath: '/html/body/main/section',
    rect: [16, 500, 600, 60],
    text: 'Synthetic Co Est. 2001',
  },
  {
    id: 'app.company.name',
    tag: 'span',
    xpath: '/html/body/main/section/span[1]',
    rect: [16, 500, 300, 20],
    text: 'Synthetic Co',
  },
  {
    id: 'app.company.since',
    tag: 'span',
    xpath: '/html/body/main/section/span[2]',
    rect: [16, 520, 300, 20],
    text: 'Est. 2001',
  },
  // A sticky bar on the bottom edge: pinned, but no landmark.
  {
    id: 'app.notice',
    tag: 'div',
    xpath: '/html/body/div',
    rect: [0, 760, 1280, 40],
    styles: { position: 'sticky' },
    text: 'Synthetic cookie notice',
  },
];

const byId = (c: DensityCapture) => Object.fromEntries(c.items.map((i) => [i.id, i]));

describe('density structure', () => {
  it('runs with no DOM', () => {
    expect(typeof document).toBe('undefined');
  });

  it('a row container with four registered spans: parents by the longest prefix, ownChars 0', () => {
    const c = byId(capture(PAGE));
    for (const span of ['no', 'state', 'sum', 'due']) {
      expect(c[`app.orders.row-1.${span}`]).toMatchObject({
        parent: 'app.orders.row-1',
        path: ['section', 'div'],
        structureBy: 'xpath',
        blockKey: '@testid=orders',
      });
    }
    // 33 characters: 30 in the spans and the 3 collapsed separators between them.
    expect(c['app.orders.row-1']).toMatchObject({
      parent: 'app.orders',
      path: ['section'],
      chars: 33,
      ownChars: 0,
    });
    expect(c['app.orders.title'].parent).toBe('app.orders');
  });

  it('a chain anchored at a data-testid takes the item with that test id as its parent', () => {
    const c = byId(capture(PAGE));
    expect(c['app.orders']).toMatchObject({
      parent: null,
      path: null,
      structureBy: 'geometry',
      ownChars: 0,
      blockKey: '@testid=orders',
    });
  });

  it('an item anchored at its own id reads its parent from geometry; its child anchors at it', () => {
    const c = byId(capture(PAGE));
    // Nothing registered contains [700, 64, 200, 20].
    expect(c['app.total']).toMatchObject({
      parent: null,
      path: null,
      structureBy: 'geometry',
      chars: 8,
      ownChars: 6,
      blockKey: null,
    });
    expect(c['app.total.amount']).toMatchObject({
      parent: 'app.total',
      path: ['span'],
      structureBy: 'xpath',
      ownChars: 2,
    });
  });

  it('a root chain with no registered prefix is a root read from the xpath', () => {
    const c = byId(capture(PAGE));
    expect(c['app.header']).toMatchObject({
      parent: null,
      path: ['html', 'body'],
      structureBy: 'xpath',
      landmark: 'banner',
      ownChars: 0,
    });
    expect(c['app.header.title']).toMatchObject({
      parent: 'app.header',
      path: ['html', 'body', 'header'],
      landmark: 'banner',
    });
    expect(c['app.help.intro'].landmark).toBe('main');
  });

  it('geometry takes the smallest containing rect with area, never one that closes a cycle', () => {
    const c = byId(
      capture([
        { id: 'app.outer', rect: [0, 0, 500, 500], text: 'A B' },
        { id: 'app.inner', rect: [10, 10, 100, 100], text: 'A' },
        { id: 'app.twin', rect: [10, 10, 100, 100], text: '' },
        { id: 'app.leaf', rect: [20, 20, 10, 10], text: 'B' },
        { id: 'app.flat', rect: [0, 0, 0, 0], text: '' },
        { id: 'app.dot', rect: [0, 0, 0, 0], text: 'C' },
      ])
    );
    expect(c['app.outer'].parent).toBe(null);
    // Identical rects: the later one cannot also be the earlier one's child.
    expect(c['app.inner'].parent).toBe('app.twin');
    expect(c['app.twin'].parent).toBe('app.outer');
    expect(c['app.leaf'].parent).toBe('app.inner');
    // A 0x0 rect contains nothing.
    expect(c['app.dot'].parent).toBe('app.outer');
    expect(Object.values(c).every((i) => i.structureBy === 'geometry')).toBe(true);
  });

  it('the semantic path gives landmark hints and never decides a parent', () => {
    const c = byId(
      capture([
        { id: 'app.a', tag: 'div', xpath: '/html/body/div', rect: [0, 0, 400, 100], text: 'x' },
        { id: 'app.b', tag: 'div', htmlId: 'b', xpath: '//*[@id="b"]', rect: [0, 200, 400, 100] },
        {
          id: 'app.x',
          tag: 'span',
          xpath: '/html/body/div/span',
          rect: [0, 0, 10, 10],
          semanticPath: '#b > span',
          text: 'x',
        },
        {
          id: 'app.y',
          tag: 'span',
          xpath: '//*[@id="y"]',
          rect: [0, 220, 10, 10],
          semanticPath: 'nav[role="navigation"].links > span',
          text: 'y',
        },
      ])
    );
    expect(c['app.x'].parent).toBe('app.a');
    expect(c['app.x'].landmark).toBe(null);
    expect(c['app.y'].parent).toBe('app.b');
    expect(c['app.y'].landmark).toBe('navigation');
  });

  it('within matchers resolve once structure is resolved', () => {
    const c = capture(PAGE);
    expect(c.structureResolved).toBe(true);
    expect(
      resolveDensityMatcher(c, { tag: 'span', within: { ids: ['app.orders.row-1'] } })
    ).toEqual({
      status: 'resolved',
      ids: [
        'app.orders.row-1.no',
        'app.orders.row-1.state',
        'app.orders.row-1.sum',
        'app.orders.row-1.due',
      ],
      textUnevaluated: 0,
    });
  });

  it('leaves: own text, or interactive or media with no registered descendant', () => {
    expect(densityLeaves(capture(PAGE))).toEqual({
      ids: [
        'app.header.title',
        'app.header.cart',
        'app.orders.title',
        'app.orders.row-1.no',
        'app.orders.row-1.state',
        'app.orders.row-1.sum',
        'app.orders.row-1.due',
        'app.total',
        'app.total.amount',
        'app.help.title',
        'app.help.intro',
        'app.help.ship',
        'app.help.ship-text',
        'app.faq.title',
        'app.faq.text',
        'app.company.name',
        'app.company.since',
        'app.notice',
      ],
      unknown: [],
    });
    const c = capture([
      {
        id: 'app.btn',
        tag: 'button',
        category: 'interactive',
        xpath: '/html/body/button',
        text: '',
      },
      { id: 'app.img', tag: 'img', xpath: '/html/body/img', text: '' },
      {
        id: 'app.box',
        tag: 'button',
        category: 'interactive',
        xpath: '/html/body/div',
        text: 'Go',
      },
      { id: 'app.box.label', tag: 'span', xpath: '/html/body/div/span', text: 'Go' },
      { id: 'app.secret', tag: 'span', xpath: '/html/body/span', text: 'x', redacted: true },
      { id: 'app.empty', tag: 'div', xpath: '/html/body/p', text: '' },
    ]);
    // An interactive container with a registered child is not a leaf; its child is.
    expect(densityLeaves(c)).toEqual({
      ids: ['app.btn', 'app.img', 'app.box.label'],
      unknown: ['app.secret'],
    });
  });

  it('pins: a fixed header on the top edge and a sticky bar on the bottom edge', () => {
    expect(densityPins(capture(PAGE))).toEqual({
      pinTopPx: 48,
      pinBottomPx: 40,
      usableHeightPx: 712,
      ids: ['app.header', 'app.notice'],
      unknown: [],
    });
    // Narrower than half the viewport, or sticky away from an edge: not a pin.
    const c = capture([
      { id: 'app.side', rect: [0, 0, 600, 800], styles: { position: 'fixed' } },
      { id: 'app.mid', rect: [0, 300, 1280, 40], styles: { position: 'sticky' } },
    ]);
    expect(densityPins(c)).toEqual({
      pinTopPx: 0,
      pinBottomPx: 0,
      usableHeightPx: 800,
      ids: [],
      unknown: [],
    });
  });
});

describe('density kinds', () => {
  it('each leaf takes the first rule that applies, recorded as kindBy', () => {
    expect(classifyDensityItems(capture(PAGE), null)).toEqual({
      items: [
        { id: 'app.header.title', kind: 'chrome', kindBy: 'landmark' },
        { id: 'app.header.cart', kind: 'chrome', kindBy: 'landmark' },
        { id: 'app.orders.title', kind: 'heading', kindBy: 'role' },
        { id: 'app.orders.row-1.no', kind: 'value', kindBy: 'shape' },
        { id: 'app.orders.row-1.state', kind: 'other', kindBy: 'other' },
        { id: 'app.orders.row-1.sum', kind: 'value', kindBy: 'shape' },
        { id: 'app.orders.row-1.due', kind: 'value', kindBy: 'shape' },
        { id: 'app.total', kind: 'value', kindBy: 'author-id' },
        { id: 'app.total.amount', kind: 'value', kindBy: 'shape' },
        { id: 'app.help.title', kind: 'heading', kindBy: 'role' },
        { id: 'app.help.intro', kind: 'prose', kindBy: 'role' },
        { id: 'app.help.ship', kind: 'heading', kindBy: 'role' },
        { id: 'app.help.ship-text', kind: 'prose', kindBy: 'role' },
        { id: 'app.faq.title', kind: 'heading', kindBy: 'role' },
        { id: 'app.faq.text', kind: 'prose', kindBy: 'role' },
        { id: 'app.company.name', kind: 'other', kindBy: 'other' },
        { id: 'app.company.since', kind: 'other', kindBy: 'other' },
        // Pinned, with no landmark.
        { id: 'app.notice', kind: 'chrome', kindBy: 'landmark' },
      ],
      unresolved: [],
    });
  });

  it('a declared rule decides before the landmark rule', () => {
    const t = targets({
      classify: [
        { match: { idPrefix: 'app.header.' }, kind: 'value' },
        { match: { idPrefix: 'app.missing.' }, kind: 'label' },
      ],
    });
    const r = classifyDensityItems(capture(PAGE, t), t);
    expect(r.items.slice(0, 2)).toEqual([
      { id: 'app.header.title', kind: 'value', kindBy: 'declared' },
      { id: 'app.header.cart', kind: 'value', kindBy: 'declared' },
    ]);
    expect(r.unresolved).toEqual([{ index: 1, reason: 'no-match' }]);
  });

  it('role rule: label, value and media tags; an interactive author-id leaf is a control', () => {
    const r = classifyDensityItems(
      capture([
        { id: 'app.dt', tag: 'dt', xpath: '/html/body/dl/dt', text: 'Due' },
        { id: 'app.dd', tag: 'dd', xpath: '/html/body/dl/dd', text: 'soon' },
        { id: 'app.cell', tag: 'div', role: 'cell', xpath: '/html/body/div[1]', text: 'x' },
        { id: 'app.status', tag: 'div', role: 'status', xpath: '/html/body/div[2]', text: 'Saved' },
        { id: 'app.pic', tag: 'img', xpath: '/html/body/img', text: '' },
        {
          id: 'app.go',
          tag: 'a',
          category: 'interactive',
          xpath: '/html/body/a',
          text: 'Go',
          origin: 'hook',
        },
        {
          id: 'app.colhead',
          tag: 'div',
          role: 'columnheader',
          xpath: '/html/body/div[3]',
          text: 'Due',
        },
        {
          id: 'app.gridcell',
          tag: 'div',
          role: 'gridcell',
          xpath: '/html/body/div[4]',
          text: 'soon',
        },
      ]),
      null
    );
    expect(r.items.map((i) => [i.id, i.kind, i.kindBy])).toEqual([
      ['app.dt', 'label', 'role'],
      ['app.dd', 'value', 'role'],
      ['app.cell', 'value', 'role'],
      ['app.status', 'prose', 'role'],
      ['app.pic', 'media', 'role'],
      ['app.go', 'control', 'role'],
      ['app.colhead', 'label', 'role'],
      ['app.gridcell', 'value', 'role'],
    ]);
  });

  it("an auto row's data-ui-bridge-id stamp is not author evidence", () => {
    const r = classifyDensityItems(
      capture([
        {
          id: 'app.auto',
          tag: 'span',
          xpath: '/html/body/span[1]',
          text: 'Pending',
          origin: 'auto',
          uiBridgeId: 'app.auto',
        },
        {
          id: 'app.hook',
          tag: 'span',
          xpath: '/html/body/span[2]',
          text: 'Pending',
          origin: 'hook',
        },
      ]),
      null
    );
    expect(r.items).toEqual([
      { id: 'app.auto', kind: 'other', kindBy: 'other' },
      { id: 'app.hook', kind: 'value', kindBy: 'author-id' },
    ]);
  });
});

describe('density blocks', () => {
  it('path blocks, heading blocks nested by level, and the leaves in none', () => {
    const b = densityBlocks(capture(PAGE), null);
    expect(b.blocks).toEqual([
      {
        id: 'path:@testid=orders',
        by: 'path',
        members: [
          'app.orders.title',
          'app.orders.row-1.no',
          'app.orders.row-1.state',
          'app.orders.row-1.sum',
          'app.orders.row-1.due',
        ],
        topPx: 64,
        heightPx: 48,
        pitchPx: 436,
        parent: null,
      },
      {
        id: 'heading:app.help.title',
        by: 'heading',
        members: ['app.help.title', 'app.help.intro', 'app.help.ship', 'app.help.ship-text'],
        topPx: 200,
        heightPx: 92,
        pitchPx: 120,
        parent: null,
      },
      {
        id: 'heading:app.help.ship',
        by: 'heading',
        members: ['app.help.ship', 'app.help.ship-text'],
        topPx: 260,
        heightPx: 44,
        pitchPx: 60,
        parent: 'heading:app.help.title',
      },
      {
        id: 'heading:app.faq.title',
        by: 'heading',
        members: ['app.faq.title', 'app.faq.text'],
        topPx: 320,
        heightPx: 48,
        pitchPx: null,
        parent: null,
      },
      {
        id: 'path:/html/body/main/section',
        by: 'path',
        members: ['app.company.name', 'app.company.since'],
        topPx: 500,
        heightPx: 40,
        pitchPx: null,
        parent: null,
      },
    ]);
    expect(b.unblocked).toEqual([
      'app.header.title',
      'app.header.cart',
      'app.total',
      'app.total.amount',
      'app.notice',
    ]);
    expect(b.unresolved).toEqual([]);
  });

  it('a heading block stops at its landmark, and a pinned leaf joins none', () => {
    const b = densityBlocks(
      capture([
        { id: 'app.h', tag: 'h2', xpath: '/html/body/h2', rect: [0, 100, 400, 28], text: 'News' },
        { id: 'app.p', tag: 'p', xpath: '/html/body/p', rect: [0, 140, 400, 20], text: 'Item' },
        {
          id: 'app.foot',
          tag: 'footer',
          xpath: '/html/body/footer',
          rect: [0, 600, 400, 20],
          text: 'Synthetic footer',
        },
        {
          id: 'app.bar',
          tag: 'div',
          xpath: '/html/body/div',
          rect: [0, 760, 1280, 40],
          styles: { position: 'fixed' },
          text: 'Synthetic bar',
        },
      ]),
      null
    );
    expect(b.blocks.map((x) => [x.id, x.members])).toEqual([['heading:app.h', ['app.h', 'app.p']]]);
    expect(b.unblocked).toEqual(['app.foot', 'app.bar']);
  });

  it('a declared block takes its leaves before the path rule, and an unresolved one is listed', () => {
    const t = targets({
      blocks: [
        { id: 'company', match: { idPrefix: 'app.company.' } },
        { id: 'ghost', match: { idPrefix: 'app.ghost.' } },
      ],
    });
    const b = densityBlocks(capture(PAGE, t), t);
    const company = b.blocks.find((x) => x.id === 'company');
    expect(company).toEqual({
      id: 'company',
      by: 'declared',
      members: ['app.company.name', 'app.company.since'],
      topPx: 500,
      heightPx: 40,
      pitchPx: null,
      parent: null,
    });
    expect(b.blocks.map((x) => x.id)).not.toContain('path:/html/body/main/section');
    expect(b.unresolved).toEqual([{ id: 'ghost', reason: 'no-match' }]);
  });
});

describe('density structure summary', () => {
  it('counts leaves, kinds by basis, blocks and structureBy', () => {
    expect(summarizeDensityStructure(capture(PAGE), null)).toEqual({
      structureResolved: true,
      structureBy: { xpath: 20, geometry: 2 },
      leaves: { count: 18, unknown: 0, geometryOwnChars: 0 },
      // app.total has a registered child: its own 6 characters are on a container.
      unattributedChars: 6,
      pins: { pinTopPx: 48, pinBottomPx: 40, usableHeightPx: 712, items: 2, unknown: 0 },
      kinds: {
        byBasis: {
          declared: {},
          landmark: { chrome: 3 },
          role: { heading: 4, prose: 3 },
          'author-id': { value: 1 },
          shape: { value: 4 },
          other: { other: 3 },
        },
        unresolvedRules: [],
      },
      blocks: {
        byBasis: { declared: 0, path: 2, heading: 3 },
        headingLevelUnknown: 0,
        shown: 5,
        total: 5,
        truncated: false,
        list: [
          {
            id: 'path:@testid=orders',
            by: 'path',
            members: 5,
            topPx: 64,
            heightPx: 48,
            pitchPx: 436,
            parent: null,
          },
          {
            id: 'heading:app.help.title',
            by: 'heading',
            members: 4,
            topPx: 200,
            heightPx: 92,
            pitchPx: 120,
            parent: null,
          },
          {
            id: 'heading:app.help.ship',
            by: 'heading',
            members: 2,
            topPx: 260,
            heightPx: 44,
            pitchPx: 60,
            parent: 'heading:app.help.title',
          },
          {
            id: 'heading:app.faq.title',
            by: 'heading',
            members: 2,
            topPx: 320,
            heightPx: 48,
            pitchPx: null,
            parent: null,
          },
          {
            id: 'path:/html/body/main/section',
            by: 'path',
            members: 2,
            topPx: 500,
            heightPx: 40,
            pitchPx: null,
            parent: null,
          },
        ],
        unresolved: [],
        unblockedLeaves: 5,
      },
    });
  });

  it('caps the block list and says so', () => {
    const s = summarizeDensityStructure(capture(PAGE), null, 2);
    if (!s.structureResolved) throw new Error('unresolved');
    expect([s.blocks.shown, s.blocks.total, s.blocks.truncated]).toEqual([2, 5, true]);
  });

  it('a capture written before structure was resolved is reported as such, not as empty', () => {
    expect(summarizeDensityStructure({ ...capture(PAGE), structureResolved: false }, null)).toEqual(
      {
        structureResolved: false,
        reason:
          'the capture was written before its structure was resolved (structureResolved: false)',
      }
    );
  });
});

describe('density structure: review round 1', () => {
  it('repeated rows sharing a data-testid: an ambiguous anchor resolves nothing, geometry does', () => {
    const c = byId(
      capture([
        {
          id: 'app.row-1',
          tag: 'li',
          xpath: '/li[@data-testid="row"]',
          testId: 'row',
          rect: [0, 0, 400, 20],
          text: 'One',
        },
        {
          id: 'app.row-1.s',
          tag: 'span',
          xpath: '/li[@data-testid="row"]/span',
          rect: [0, 0, 100, 20],
          text: 'One',
        },
        {
          id: 'app.row-2',
          tag: 'li',
          xpath: '/li[@data-testid="row"]',
          testId: 'row',
          rect: [0, 20, 400, 20],
          text: 'Two',
        },
        {
          id: 'app.row-2.s',
          tag: 'span',
          xpath: '/li[@data-testid="row"]/span',
          rect: [0, 20, 100, 20],
          text: 'Two',
        },
      ])
    );
    expect(c['app.row-1.s']).toMatchObject({ parent: 'app.row-1', structureBy: 'geometry' });
    expect(c['app.row-2.s']).toMatchObject({ parent: 'app.row-2', structureBy: 'geometry' });
    expect([c['app.row-1'].ownChars, c['app.row-2'].ownChars]).toEqual([0, 0]);
  });

  it('a deeper key one repeated row alone registered does not adopt the other row', () => {
    const c = byId(
      capture([
        {
          id: 'app.c1.d',
          tag: 'div',
          xpath: '/li[@data-testid="card"]/div[2]',
          rect: [0, 0, 400, 20],
          text: 'One',
        },
        {
          id: 'app.c1.s',
          tag: 'span',
          xpath: '/li[@data-testid="card"]/div[2]/span',
          rect: [0, 0, 100, 20],
          text: 'One',
        },
        {
          id: 'app.c2.s',
          tag: 'span',
          xpath: '/li[@data-testid="card"]/div[2]/span',
          rect: [0, 40, 100, 20],
          text: 'Two',
        },
      ])
    );
    expect(c['app.c2.s']).toMatchObject({ parent: null, structureBy: 'geometry' });
    expect(c['app.c1.s']).toMatchObject({ parent: 'app.c1.d', structureBy: 'geometry' });
  });

  it('repeated cards with an unregistered section share no path block', () => {
    const cap = capture([
      {
        id: 'app.c1.s',
        tag: 'span',
        xpath: '/div[@data-testid="card"]/section/span',
        rect: [0, 0, 100, 20],
        text: 'One',
      },
      {
        id: 'app.c2.s',
        tag: 'span',
        xpath: '/div[@data-testid="card"]/section/span',
        rect: [0, 500, 100, 20],
        text: 'Two',
      },
    ]);
    expect(cap.items.map((i) => i.blockKey)).toEqual([null, null]);
    const b = densityBlocks(cap, null);
    expect([b.blocks, b.unblocked]).toEqual([[], ['app.c1.s', 'app.c2.s']]);
  });

  it("two chains anchored at each other never become each other's parent", () => {
    const c = byId(
      capture([
        {
          id: 'app.a',
          tag: 'div',
          xpath: '/div[@data-testid="b"]/div',
          testId: 'a',
          rect: [0, 0, 100, 100],
          text: 'a',
        },
        {
          id: 'app.b',
          tag: 'div',
          xpath: '/div[@data-testid="a"]/div',
          testId: 'b',
          rect: [200, 0, 100, 100],
          text: 'b',
        },
      ])
    );
    expect(c['app.a'].parent).toBe('app.b');
    expect(c['app.b'].parent).toBe(null);
  });

  it('the landmark is the innermost: a registered navigation inside main', () => {
    const c = byId(
      capture([
        {
          id: 'app.nav',
          tag: 'div',
          role: 'navigation',
          xpath: '/html/body/main/div',
          rect: [0, 0, 400, 100],
        },
        {
          id: 'app.link',
          tag: 'span',
          xpath: '/html/body/main/div/span',
          rect: [0, 0, 50, 20],
          text: 'Home',
        },
      ])
    );
    expect(c['app.nav'].landmark).toBe('navigation');
    expect(c['app.link'].landmark).toBe('navigation');
  });

  it('a header with unknown ancestry is no landmark; with a root chain it is the banner', () => {
    const c = byId(
      capture([
        { id: 'app.h-own', tag: 'header', xpath: '//*[@id="h"]', rect: [0, 0, 400, 40], text: 'x' },
        {
          id: 'app.h-anchored',
          tag: 'header',
          xpath: '/div[@data-testid="t"]/header',
          rect: [0, 100, 400, 40],
          text: 'y',
        },
        {
          id: 'app.h-root',
          tag: 'header',
          xpath: '/html/body/header',
          rect: [0, 200, 400, 40],
          text: 'z',
        },
        {
          id: 'app.h-scoped',
          tag: 'header',
          xpath: '/html/body/article/header',
          rect: [0, 300, 400, 40],
          text: 'w',
        },
      ])
    );
    expect(c['app.h-own'].landmark).toBe(null);
    expect(c['app.h-anchored'].landmark).toBe(null);
    expect(c['app.h-root'].landmark).toBe('banner');
    expect(c['app.h-scoped'].landmark).toBe(null);
  });

  it("a redacted child makes its parent's ownChars unknown, and the parent an unknown leaf", () => {
    const cap = capture([
      { id: 'app.p', tag: 'div', xpath: '/html/body/div', text: 'Total 42' },
      { id: 'app.p.s', tag: 'span', xpath: '/html/body/div/span', text: '42', redacted: true },
    ]);
    expect(byId(cap)['app.p'].ownChars).toBe(null);
    expect(densityLeaves(cap)).toEqual({ ids: [], unknown: ['app.p', 'app.p.s'] });
  });

  it('pins: a fixed bottom bar, a scrolled capture, and an item with no computed position', () => {
    const scrolled = captureDensityFromSnapshot(
      densityTestSnapshot({
        viewport: { scrollY: 300 },
        elements: [
          { id: 'app.top', rect: [0, 0, 1280, 50], styles: { position: 'fixed' } },
          { id: 'app.bottom', rect: [0, 740, 1280, 60], styles: { position: 'fixed' } },
          { id: 'app.stuck', rect: [0, 50, 1280, 30], styles: { position: 'sticky' } },
          { id: 'app.stuck-top', rect: [0, 0, 1280, 30], styles: { position: 'sticky' } },
          { id: 'app.nostyle', rect: [0, 400, 1280, 30], styles: false },
          // Scrolled away from both edges now; at scroll 0 it may sit at the top.
          { id: 'app.sticky-away', rect: [0, 100, 1280, 30], styles: { position: 'sticky' } },
          {
            id: 'app.unseen',
            rect: [0, 0, 1280, 30],
            styles: { position: 'fixed' },
            visible: false,
          },
        ],
      }),
      { producer: DENSITY_TEST_PRODUCER, evaluatedAt: '2026-11-23T10:00:00.000Z' }
    );
    if (scrolled.status !== 'measured') throw new Error(scrolled.status);
    expect(densityPins(scrolled.value)).toEqual({
      pinTopPx: 50,
      pinBottomPx: 60,
      usableHeightPx: 690,
      ids: ['app.top', 'app.bottom'],
      // Every sticky item in a capture taken at scroll 300 (a pin is judged at
      // scroll 0), the item with no computed position, and a fixed bar whose
      // visibility is unknown.
      unknown: ['app.stuck', 'app.stuck-top', 'app.nostyle', 'app.sticky-away', 'app.unseen'],
    });
  });

  it('two headings at one y: neither lists the other, and the blocks terminate', () => {
    const b = densityBlocks(
      capture([
        { id: 'app.h-a', tag: 'h2', xpath: '/html/body/h2[1]', rect: [0, 100, 400, 28], text: 'A' },
        { id: 'app.h-b', tag: 'h2', xpath: '/html/body/h2[2]', rect: [0, 100, 400, 28], text: 'B' },
        { id: 'app.p', tag: 'p', xpath: '/html/body/p', rect: [0, 140, 400, 20], text: 'Text' },
        { id: 'app.h-c', tag: 'h3', xpath: '/html/body/h3', rect: [0, 100, 400, 28], text: 'C' },
      ]),
      null
    );
    expect(b.blocks.map((x) => [x.id, x.members, x.parent])).toEqual([
      ['heading:app.h-a', ['app.h-a'], null],
      ['heading:app.h-b', ['app.h-b', 'app.p', 'app.h-c'], null],
      ['heading:app.h-c', ['app.p', 'app.h-c'], 'heading:app.h-b'],
    ]);
  });

  it('a role heading of unknown level nests nothing and sits inside nothing', () => {
    const b = densityBlocks(
      capture([
        { id: 'app.h2', tag: 'h2', xpath: '/html/body/h2', rect: [0, 100, 400, 28], text: 'A' },
        {
          id: 'app.rh',
          tag: 'div',
          role: 'heading',
          xpath: '/html/body/div',
          rect: [0, 140, 400, 28],
          text: 'B',
        },
        { id: 'app.p', tag: 'p', xpath: '/html/body/p', rect: [0, 180, 400, 20], text: 'Text' },
      ]),
      null
    );
    expect(b.blocks.map((x) => [x.id, x.members, x.parent])).toEqual([
      ['heading:app.h2', ['app.h2'], null],
      ['heading:app.rh', ['app.rh', 'app.p'], null],
    ]);
  });

  it('a capture file written before blockKey existed still parses', () => {
    const c = capture(PAGE);
    const old = { ...c, items: c.items.map(({ blockKey: _b, ...rest }) => rest) };
    const parsed = parseDensityCapture(JSON.parse(JSON.stringify(old)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.items.every((i) => i.blockKey === null)).toBe(true);
  });

  it('the summary counts containers whose ownChars subtracted a geometry child', () => {
    const s = summarizeDensityStructure(
      capture([
        {
          id: 'app.card',
          tag: 'div',
          xpath: '/html/body/div',
          rect: [0, 0, 400, 100],
          text: 'Card 9',
        },
        {
          id: 'app.badge',
          tag: 'span',
          xpath: '//*[@id="badge"]',
          rect: [10, 10, 20, 20],
          text: '9',
        },
        {
          id: 'app.box',
          tag: 'div',
          xpath: '/html/body/section',
          rect: [0, 200, 400, 100],
          text: 'Box',
        },
        {
          id: 'app.icon',
          tag: 'span',
          xpath: '//*[@id="icon"]',
          rect: [10, 210, 20, 20],
          text: '',
        },
      ]),
      null
    );
    if (!s.structureResolved) throw new Error('unresolved');
    // app.box's geometry child has no text, so the assumption changed nothing there.
    expect(s.leaves).toEqual({ count: 3, unknown: 0, geometryOwnChars: 1 });
  });
});
