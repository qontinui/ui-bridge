// @vitest-environment node
/**
 * `measure` beyond the metamorphic relations: unresolved and unanswered asks,
 * `need: all`, pins, caps, invariance, the ledger's grid, the bounds, and how
 * an aria-label / title the serializer substituted for absent text is read
 * (never as an answer's visible text). Every expected value is a literal.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 5).
 */
import { describe, expect, it } from 'vitest';
import { captureDensityFromSnapshot } from '../capture-from-snapshot';
import { densityLedger, densityPlacedRects, type DensityLedgerKind } from '../ledger';
import { measureDensity, type DensityMeasureReport } from '../measure';
import {
  parseDensityCapture,
  parseDensityTargets,
  type DensityCapture,
  type DensityTargets,
} from '../schema';
import { densityPins } from '../structure';
import {
  DENSITY_TEST_PRODUCER,
  densityTestSnapshot,
  type DensityTestElementSpec,
} from './fixtures/snapshot-builder';
import {
  measurePageCapture,
  measurePageTargets,
  type MeasurePageOptions,
} from './fixtures/measure-page';

it('runs with no DOM', () => {
  expect(typeof document).toBe('undefined');
});

function report(
  capture: DensityCapture,
  targets: DensityTargets | null,
  extra: { captures?: DensityCapture[]; cap?: number } = {}
): DensityMeasureReport {
  const obs = measureDensity(capture, {
    producer: DENSITY_TEST_PRODUCER,
    targets,
    evaluatedAt: '2026-11-24T10:00:00.000Z',
    ...extra,
  });
  if (obs.status !== 'measured') throw new Error(`expected measured, got ${JSON.stringify(obs)}`);
  return obs.value;
}

function page(o: MeasurePageOptions = {}, targets = measurePageTargets()): DensityMeasureReport {
  return report(measurePageCapture(o, targets), targets);
}

const ask = (r: DensityMeasureReport, id: string) => r.role!.asks.find((a) => a.id === id)!;

function capture(
  elements: DensityTestElementSpec[],
  targets: DensityTargets | null = null,
  viewport = {}
) {
  const obs = captureDensityFromSnapshot(densityTestSnapshot({ elements, viewport }), {
    producer: DENSITY_TEST_PRODUCER,
    role: 'buyer',
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

describe('density measure: asks and role quantities', () => {
  it('an unresolved ask widens answeredAt[k] and keeps a block out of the unclaimed list', () => {
    const targets = measurePageTargets([
      { id: 'B5', rank: 5, weight: 2, kind: 'state', answer: { idPrefix: 'app.missing.' } },
    ]);
    const r = page({ blocks: ['promo', 'orders'] }, targets);
    expect(ask(r, 'B5').state).toBe('unresolved');
    expect(ask(r, 'B5').unresolvedBy).toEqual(['no-match']);
    expect(r.role!.unresolvedWeight).toBe(2);
    expect(r.role!.answeredAt).toEqual([
      { k: 0, lo: 0, hi: 0.2 },
      { k: 1, lo: 0.5, hi: 0.7 },
      { k: 2, lo: 0.6, hi: 0.8 },
      { k: 3, lo: 0.6, hi: 0.8 },
    ]);
    expect(r.unclaimed).toEqual({ shown: 0, total: 0, truncated: false, list: [] });
    expect(r.possiblyUnclaimed!.list).toEqual([
      {
        block: 'path:/html/body/main/article',
        firstScreenPx: 580,
        displacementPx: 76,
        unresolvedWeight: 2,
      },
    ]);
    // While asks are unresolved no block is known unclaimed, so only chrome is foreign.
    expect(r.role!.foreignBasis).toBe('chrome-only');
    expect(ask(r, 'B1').all!.foreignPx).toBe(64);
  });

  it('answer: null lists as unanswered and widens nothing', () => {
    const r = page();
    expect(ask(r, 'B3').state).toBe('unanswered');
    expect(ask(r, 'B3').first).toBe(null);
    expect(r.role!.unanswered).toEqual(['B3']);
    expect(r.role!.unresolvedWeight).toBe(0);
    for (const a of r.role!.answeredAt) expect(a.lo).toBe(a.hi);
    // B3's weight (2 of 8) is in the denominator and in neither bound.
    expect(r.role!.answeredAt[3]).toEqual({ k: 3, lo: 0.75, hi: 0.75 });
  });

  it('a need: all ask reports its last leaf', () => {
    const r = page({ blocks: ['promo', 'orders'] });
    const b1 = ask(r, 'B1');
    expect(b1.need).toBe('all');
    expect(b1.first!.id).toBe('app.orders.row1');
    expect(b1.first!.scrollPx).toBe(0);
    expect(b1.all).toEqual({
      lastItem: 'app.orders.row3',
      scrollPx: 30,
      gestures: 1,
      interactions: 0,
      keystrokes: 0,
      actions: 1,
      foreignPx: 644,
      available: true,
      unknownItems: 0,
    });
    expect(b1.answerItems).toMatchObject({ total: 3, firstScreen: 2, shown: 3, truncated: false });
    expect(b1.available).toBe(true);
  });

  it('a pinned footer raises scrollPx', () => {
    const without = ask(page(), 'B2').first!;
    const withFooter = ask(page({ footerPx: 60 }), 'B2').first!;
    expect(without.scrollPx).toBe(124);
    expect(withFooter.scrollPx).toBe(184);
  });

  it('the means are weighted, with unweighted twins, over the asks whose reach is known', () => {
    const r = page({ blocks: ['promo', 'orders'] });
    // B1 (weight 5) scrolls 30, B2 (weight 1) scrolls 734; B3 is unanswered.
    expect(r.role!.meanScrollPx).toEqual({
      value: (5 * 30 + 734) / 6,
      over: { asks: 2, weight: 6 },
      excluded: { asks: 0, weight: 0 },
    });
    expect(r.role!.unweighted.meanScrollPx.value).toBe((30 + 734) / 2);
    expect(r.role!.meanInteractions.value).toBe(0);
  });

  it('the block quantities: first-screen height, claimed weight and displacement', () => {
    const r = page();
    expect(
      r.blocks.list.map((b) => [b.id, b.firstScreenPx, b.claimedWeight, b.displacementPx])
    ).toEqual([
      // 30 + 3 × 20 px of the orders section on the first screen; B2 is below
      // it and scrolls 124 px, less than the 800 px pitch: 1 × 124 / 8.
      ['path:/html/body/main/section[1]', 90, 5, 15.5],
      ['path:/html/body/main/section[2]', 0, 1, 0],
    ]);
  });
});

describe('density measure: report shape', () => {
  it('carries interactionsBasis static, the structureBy and kindBy counts, and the targets hash', () => {
    const targets = measurePageTargets();
    const r = page({}, targets);
    expect(r.bases).toMatchObject({
      foldBasis: 'reprojected',
      pinBasis: 'registered-only',
      scrollBasis: 'page',
      interactionsBasis: 'static',
      structureBy: { xpath: 6, geometry: 0 },
      kindBy: { declared: 0, landmark: 1, role: 2, 'author-id': 0, shape: 3, other: 0 },
    });
    expect(r.scope).toBe('registered');
    expect(r.next).toEqual(['review-targets']);
  });

  it('with no targets file: ledger, blocks and bounds, no ask or role section, next write-targets', () => {
    const r = report(measurePageCapture({}, null), null);
    expect(r.role).toBeUndefined();
    expect(r.unclaimed).toBeUndefined();
    expect(r.possiblyUnclaimed).toBeUndefined();
    expect(r.blocks.total).toBe(2);
    expect(r.blocks.list[0]).not.toHaveProperty('claimedWeight');
    expect(r.ledger.firstScreen.byKind.answer.cells).toBe(0);
    expect(r.bounds.fontPx).toMatchObject({ min: 13 });
    expect(r.next).toEqual(['write-targets']);
  });

  it('a cap reports its total', () => {
    const targets = measurePageTargets();
    const r = report(measurePageCapture({}, targets), targets, { cap: 1 });
    expect(r.blocks).toMatchObject({ shown: 1, total: 2, truncated: true });
    expect(r.blocks.list.map((b) => b.id)).toEqual(['path:/html/body/main/section[1]']);
  });

  it('a block whose text is the same in three captures reports identical 3 of 3; one capture is unknown', () => {
    const targets = measurePageTargets();
    const caps = ['a', 'b', 'c'].map((fixture) => measurePageCapture({ fixture }, targets));
    const r = report(caps[0], targets, { captures: caps });
    expect(r.blocks.list[0].invariance).toEqual({ identical: 3, of: 3, across: ['fixture'] });
    const one = report(caps[0], targets);
    expect(one.blocks.list[0].invariance).toEqual({
      unknown: 'input_missing',
      reason: 'invariance is read across captures, and this invocation measured one',
    });
  });

  it('a capture whose structure was never resolved answers unknown{input_missing}', () => {
    const cap = { ...measurePageCapture({}, null), structureResolved: false };
    const obs = measureDensity(cap, { producer: DENSITY_TEST_PRODUCER });
    expect(obs.status).toBe('unknown');
    expect(obs.status === 'unknown' && obs.unknown.code).toBe('input_missing');
  });
});

describe('density ledger', () => {
  it('each 8 px cell goes to the smallest covering leaf; shares sum to 1', () => {
    // 80 x 40 viewport: 10 x 5 cells. The card covers 5 x 2 cells, the badge
    // inside it 1 x 1, which it wins.
    const cap = capture(
      [
        { id: 'app.card', tag: 'p', xpath: '/html/body/p', rect: [0, 0, 40, 16], text: 'Card' },
        { id: 'app.badge', tag: 'span', xpath: '/html/body/span', rect: [8, 8, 8, 8], text: '1' },
      ],
      null,
      { viewportWidth: 80, viewportHeight: 40, documentWidth: 80, documentHeight: 40 }
    );
    const kinds = new Map<string, DensityLedgerKind>([
      ['app.card', 'prose'],
      ['app.badge', 'answer'],
    ]);
    const ledger = densityLedger(cap, kinds, densityPlacedRects(cap, densityPins(cap)));
    expect(ledger.firstScreen.cells).toBe(50);
    expect(ledger.firstScreen.byKind.prose).toEqual({ cells: 9, share: 0.18 });
    expect(ledger.firstScreen.byKind.answer).toEqual({ cells: 1, share: 0.02 });
    expect(ledger.firstScreen.byKind.uncovered).toEqual({ cells: 40, share: 0.8 });
    const total = Object.values(ledger.firstScreen.byKind).reduce((s, k) => s + (k.share ?? 0), 0);
    expect(total).toBeCloseTo(1, 12);
    expect(ledger.uncoveredMeans).toBe('unregistered-or-empty');
    expect(ledger.contentTopPx).toBe(0);
  });

  it('the first screen is document y in [0, H), and a fixed header stays at its viewport place', () => {
    const r = page();
    // The header (1280 x 64 px: 160 x 8 cells) is chrome on the first screen
    // although the capture was taken at scrollY 300.
    expect(r.ledger.firstScreen.byKind.chrome.cells).toBe(160 * 8);
    expect(r.ledger.contentTopPx).toBe(100);
    expect(r.ledger.page.heightPx).toBe(2400);
  });
});

describe('density bounds and text that is not drawn', () => {
  const ICON: DensityTestElementSpec = {
    id: 'app.orders.delete',
    tag: 'button',
    category: 'interactive',
    xpath: '/html/body/main/button',
    rect: [0, 100, 32, 32],
    // The serializer filled textContent from aria-label: no visible text.
    text: 'Delete order',
    visibleText: null,
    nameSource: 'aria-label',
  };

  it('the adapter reads charsDrawn: visible text, a label fallback, and a serializer too old to say', () => {
    const cap = capture([
      { id: 'app.total', tag: 'span', xpath: '/html/body/span', text: '7', nameSource: 'text' },
      ICON,
      { id: 'app.old', tag: 'span', xpath: '/html/body/em', text: 'Old', visibleText: null },
      { id: 'app.empty', tag: 'div', xpath: '/html/body/div', nameSource: 'none' },
    ]);
    expect(cap.items.map((i) => [i.id, i.chars, i.charsDrawn])).toEqual([
      ['app.total', 1, true],
      ['app.orders.delete', 12, false],
      ['app.old', 3, null],
      ['app.empty', 0, true],
    ]);
    expect(cap.coverage.unmeasured).toEqual([
      { dimension: 'charsDrawn', count: 1, code: 'input_missing' },
    ]);
  });

  it("an icon-only control's label is never an answer's visible text", () => {
    const targets = targetsOf([
      { id: 'S1', rank: 1, weight: 1, kind: 'state', answer: { ids: ['app.orders.delete'] } },
      { id: 'A1', rank: 2, weight: 1, kind: 'action', answer: { ids: ['app.orders.delete'] } },
    ]);
    const r = report(capture([ICON], targets), targets);
    const s1 = r.role!.asks.find((a) => a.id === 'S1')!;
    const a1 = r.role!.asks.find((a) => a.id === 'A1')!;
    expect([s1.available, s1.first!.unavailableBy]).toEqual([false, ['text-not-drawn']]);
    // An action is answered by the control itself.
    expect([a1.available, a1.first!.unavailableBy]).toEqual([true, []]);
    expect(r.role!.answeredAt[0]).toEqual({ k: 0, lo: 0.5, hi: 0.5 });
  });

  it('a label-only leaf is excluded from the font bound, and counted', () => {
    const targets = targetsOf([
      {
        id: 'S1',
        rank: 1,
        weight: 1,
        kind: 'state',
        answer: { ids: ['app.orders.delete', 'app.total'] },
      },
    ]);
    const r = report(
      capture(
        [
          { ...ICON, styles: { fontSize: '6px', lineHeight: '8px' } },
          {
            id: 'app.total',
            tag: 'span',
            xpath: '/html/body/span',
            rect: [0, 200, 80, 20],
            text: '7',
            nameSource: 'text',
          },
        ],
        targets
      ),
      targets
    );
    expect(r.bounds.textLeaves).toEqual({
      considered: 2,
      undrawn: 1,
      drawnUnknown: 0,
      fontUnknown: 0,
      lineHeightUnknown: 0,
      visibilityUnknown: 0,
      leafUnknown: 0,
    });
    expect(r.bounds.fontPx).toMatchObject({ min: 14, p10: 14, of: 1 });
  });

  it('controls: the smallest side and gap; truncated and occluded leaves are listed', () => {
    const r = report(
      capture([
        {
          id: 'app.a',
          tag: 'button',
          category: 'interactive',
          xpath: '/html/body/button[1]',
          rect: [0, 0, 40, 24],
          text: 'A',
        },
        {
          id: 'app.b',
          tag: 'button',
          category: 'interactive',
          xpath: '/html/body/button[2]',
          rect: [46, 0, 40, 30],
          text: 'B',
        },
        {
          id: 'app.cut',
          tag: 'span',
          xpath: '/html/body/span',
          rect: [0, 100, 50, 20],
          text: 'A long synthetic label',
          scrollWidth: 140,
          clientWidth: 50,
          styles: { overflow: 'hidden' },
          nameSource: 'title',
        },
        {
          id: 'app.under',
          tag: 'p',
          xpath: '/html/body/p',
          rect: [0, 200, 50, 20],
          text: 'Under',
          visible: false,
          visibilityReason: 'occluded',
        },
      ]),
      null
    );
    expect(r.bounds.controls.minSidePx).toEqual({
      value: 24,
      atMin: { shown: 1, total: 1, truncated: false, ids: ['app.a'] },
    });
    expect(r.bounds.controls.minGapPx).toEqual({ value: 6, between: ['app.a', 'app.b'] });
    expect(r.bounds.truncated).toEqual({
      shown: 1,
      total: 1,
      truncated: false,
      ids: ['app.cut'],
      list: [{ id: 'app.cut', recoverable: true }],
    });
    expect(r.bounds.occluded.ids).toEqual(['app.under']);
  });

  it('a capture file written before charsDrawn existed parses, with charsDrawn unknown', () => {
    const cap = measurePageCapture({}, null);
    const raw = JSON.parse(JSON.stringify(cap)) as { items: Array<Record<string, unknown>> };
    for (const i of raw.items) delete i.charsDrawn;
    const parsed = parseDensityCapture(raw);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
    expect(parsed.value.items.every((i) => i.charsDrawn === null)).toBe(true);
  });
});

describe('density measure: review round 1', () => {
  const REDACTED_NOTE: DensityTestElementSpec = {
    id: 'app.help.note',
    tag: 'span',
    xpath: '/html/body/main/section[2]/span',
    rect: [16, 1600, 600, 20],
    text: 'Synthetic secret',
    redacted: true,
  };

  it('an answer in a pinned footer needs no scroll', () => {
    const targets = measurePageTargets([
      { id: 'F1', rank: 4, weight: 1, kind: 'reference', answer: { ids: ['app.footer'] } },
    ]);
    const f1 = ask(page({ footerPx: 60 }, targets), 'F1');
    expect([f1.first!.scrollPx, f1.first!.actions, f1.answerItems.firstScreen]).toEqual([0, 0, 1]);
  });

  it('a role whose asks weigh nothing has answeredAt null, never 0', () => {
    const targets = targetsOf([]);
    const r = report(
      capture([{ id: 'app.a', tag: 'p', xpath: '/html/body/p', text: 'A' }], targets),
      targets
    );
    expect(r.role!.totalWeight).toBe(0);
    expect(r.role!.answeredAt[0]).toEqual({ k: 0, lo: null, hi: null });
  });

  it('items of unknown leaf status are counted by the ledger and the bounds, not dropped', () => {
    const r = report(
      capture([
        { id: 'app.box', tag: 'p', xpath: '/html/body/p', rect: [0, 0, 200, 40], text: 'Box' },
        { ...REDACTED_NOTE, xpath: '/html/body/p/span', rect: [0, 0, 100, 20] },
      ]),
      null
    );
    expect(r.ledger.unpainted.leafUnknown).toBe(2);
    expect(r.bounds.textLeaves.leafUnknown).toBe(2);
  });

  it('an ask answered by an item no block can hold keeps blocks out of the unclaimed list', () => {
    const targets = measurePageTargets([
      { id: 'U1', rank: 4, weight: 2, kind: 'lookup', answer: { ids: ['app.help.note'] } },
    ]);
    const r = page({ blocks: ['promo', 'orders'], extra: [REDACTED_NOTE] }, targets);
    expect(r.role!.unplacedWeight).toBe(2);
    expect(r.unclaimed!.list).toEqual([]);
    expect(r.possiblyUnclaimed!.list.map((b) => [b.block, b.unresolvedWeight])).toEqual([
      ['path:/html/body/main/article', 2],
    ]);
  });

  it('a text matcher that could not read every item leaves its ask partial', () => {
    const targets = measurePageTargets([
      { id: 'T1', rank: 4, weight: 1, kind: 'reference', answer: { text: 'Synthetic help' } },
    ]);
    const r = page({ extra: [REDACTED_NOTE] }, targets);
    const t1 = ask(r, 'T1');
    expect([t1.state, t1.partial, t1.unresolvedBy]).toEqual([
      'rendered',
      true,
      ['text-unevaluated'],
    ]);
    expect(r.role!.unresolvedWeight).toBe(1);
  });

  it('need any: the first item is the first one that can be read', () => {
    const targets = targetsOf([
      { id: 'S1', rank: 1, weight: 1, kind: 'state', answer: { ids: ['app.a', 'app.b'] } },
    ]);
    const r = report(
      capture(
        [
          {
            id: 'app.a',
            tag: 'span',
            xpath: '/html/body/span[1]',
            rect: [0, 100, 80, 20],
            text: '1',
            visible: false,
            visibilityReason: 'occluded',
          },
          {
            id: 'app.b',
            tag: 'span',
            xpath: '/html/body/span[2]',
            rect: [0, 900, 80, 20],
            text: '2',
          },
        ],
        targets
      ),
      targets
    );
    const s1 = r.role!.asks[0];
    expect([s1.first!.id, s1.first!.scrollPx, s1.available]).toEqual(['app.b', 120, true]);
    expect(r.role!.answeredAt.slice(0, 2)).toEqual([
      { k: 0, lo: 0, hi: 0 },
      { k: 1, lo: 1, hi: 1 },
    ]);
  });

  it('the 10th percentile is nearest-rank, not the minimum', () => {
    const r = report(
      capture(
        Array.from({ length: 11 }, (_, i) => ({
          id: `app.v${i}`,
          tag: 'span',
          xpath: `/html/body/span[${i + 1}]`,
          rect: [0, 40 * i, 80, 20] as [number, number, number, number],
          text: '1',
          styles: { fontSize: `${10 + i}px`, lineHeight: `${20 + i}px` },
        }))
      ),
      null
    );
    expect(r.bounds.fontPx).toMatchObject({ min: 10, p10: 11, of: 11 });
  });
});
