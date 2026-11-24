/**
 * Synthetic pages for the planning tests, laid out in DOCUMENT space at
 * scroll 0 (so the snapshot's viewport rects are the document rects). Every
 * block's top is a parameter, so a test can build the page an edit should
 * produce by hand, with literal positions, and compare.
 *
 * The element ORDER never depends on the layout: two pages built here differ
 * only in geometry, as a page and its edited prediction do.
 *
 * Every id and text is synthetic (plan D5).
 */

import { captureDensityFromSnapshot } from '../../capture-from-snapshot';
import { parseDensityTargets, type DensityCapture, type DensityTargets } from '../../schema';
import {
  DENSITY_TEST_PRODUCER,
  densityTestSnapshot,
  type DensityTestElementSpec,
} from './snapshot-builder';

function font(px: number, lh: number) {
  return { fontSize: `${px}px`, lineHeight: `${lh}px` };
}

const HEADER: DensityTestElementSpec = {
  id: 'app.header',
  tag: 'header',
  xpath: '/html/body/header',
  rect: [0, 0, 1280, 64],
  styles: { position: 'fixed', ...font(16, 24) },
  text: 'Synthetic Shop',
};

/** The block page: a fixed header, the orders section, a promo article and a help section. */
export interface PlanPageLayout {
  /** Top of the promo article; `null` leaves it out. */
  promoY: number | null;
  ordersY: number;
  helpY: number;
  /** The help paragraph's width (narrow by default: it shifts with a 600 px subject only by the narrower width). */
  helpW?: number;
  documentHeight?: number;
  extra?: DensityTestElementSpec[];
  relationships?: Array<{ source: string; target: string; type: 'controls' }>;
}

export function planPageElements(l: PlanPageLayout): DensityTestElementSpec[] {
  const els: DensityTestElementSpec[] = [HEADER];
  if (l.promoY !== null) {
    const a = '/html/body/main/article';
    const y = l.promoY;
    els.push(
      {
        id: 'app.promo.p1',
        tag: 'p',
        xpath: `${a}/p[1]`,
        rect: [16, y, 600, 300],
        styles: font(16, 24),
        text: 'Synthetic promo one',
      },
      {
        id: 'app.promo.p2',
        tag: 'p',
        xpath: `${a}/p[2]`,
        rect: [16, y + 300, 600, 260],
        styles: font(16, 24),
        text: 'Synthetic promo two',
      },
      {
        id: 'app.promo.price',
        tag: 'span',
        xpath: `${a}/span`,
        rect: [16, y + 570, 600, 20],
        styles: font(11, 16),
        text: '99',
      }
    );
  }
  const s = '/html/body/main/section[1]';
  els.push({
    id: 'app.orders.title',
    tag: 'h2',
    xpath: `${s}/h2`,
    rect: [16, l.ordersY, 600, 30],
    styles: font(20, 30),
    text: 'Open orders',
  });
  for (let k = 1; k <= 3; k++) {
    els.push({
      id: `app.orders.row${k}`,
      tag: 'span',
      xpath: `${s}/span[${k}]`,
      rect: [16, l.ordersY + 40 + 30 * (k - 1), 600, 20],
      styles: font(13, 20),
      text: '12,50',
    });
  }
  els.push({
    id: 'app.help.p',
    tag: 'p',
    xpath: '/html/body/main/section[2]/p',
    rect: [16, l.helpY, l.helpW ?? 200, 40],
    styles: font(16, 24),
    text: 'Synthetic help text',
  });
  for (const e of l.extra ?? []) els.push(e);
  return els;
}

/** Capture a page built from elements, as `role` (default the buyer). */
export function planCapture(
  elements: DensityTestElementSpec[],
  o: {
    documentHeight?: number;
    targets?: DensityTargets | null;
    role?: string;
    relationships?: Array<{ source: string; target: string; type: 'controls' }>;
    viewport?: { viewportWidth?: number; viewportHeight?: number };
  } = {}
): DensityCapture {
  const obs = captureDensityFromSnapshot(
    densityTestSnapshot({
      elements,
      viewport: { scrollY: 0, documentHeight: o.documentHeight ?? 2400, ...(o.viewport ?? {}) },
      relationships: o.relationships,
    }),
    {
      producer: DENSITY_TEST_PRODUCER,
      role: o.role ?? 'buyer',
      fixture: null,
      targets: o.targets ?? null,
      evaluatedAt: '2026-11-24T10:00:00.000Z',
    }
  );
  if (obs.status !== 'measured') throw new Error(`expected measured, got ${JSON.stringify(obs)}`);
  return obs.value;
}

export function planPageCapture(
  l: PlanPageLayout,
  targets: DensityTargets | null = planTargets()
): DensityCapture {
  return planCapture(planPageElements(l), {
    documentHeight: l.documentHeight,
    targets,
    relationships: l.relationships,
  });
}

/** A list page: a heading and `rows` registered rows at `pitch`, then the help paragraph. */
export function listPageElements(o: {
  rows: number;
  pitch: number;
  helpY: number;
}): DensityTestElementSpec[] {
  const s = '/html/body/main/section[1]';
  const els: DensityTestElementSpec[] = [
    HEADER,
    {
      id: 'app.list.title',
      tag: 'h2',
      xpath: `${s}/h2`,
      rect: [16, 100, 600, 30],
      styles: font(20, 30),
      text: 'Rows',
    },
  ];
  for (let k = 1; k <= o.rows; k++) {
    els.push({
      id: `app.list.row${k}`,
      tag: 'span',
      xpath: `${s}/span[${k}]`,
      rect: [16, 140 + o.pitch * (k - 1), 600, 20],
      styles: font(16, 20),
      text: `Synthetic row ${k}`,
    });
  }
  els.push({
    id: 'app.help.p',
    tag: 'p',
    xpath: '/html/body/main/section[2]/p',
    rect: [16, o.helpY, 200, 40],
    styles: font(16, 24),
    text: 'Synthetic help text',
  });
  return els;
}

/** The buyer's targets: B1 the order rows (need all), B2 the help paragraph, B3 unanswered, and any extras. */
export function planTargets(extraAsks: Array<Record<string, unknown>> = []): DensityTargets {
  const ask = (a: Record<string, unknown>) => ({
    question: `Synthetic question ${String(a.id)}?`,
    source: { doc: 'audience_profile/synthetic@1', quote: 'Synthetic sentence.' },
    ...a,
  });
  const parsed = parseDensityTargets({
    schema: 'ui-bridge/density-targets@1',
    surface: '/orders',
    profile: 'audience_profile/synthetic@1',
    roles: [
      {
        role: 'buyer',
        asks: [
          ask({
            id: 'B1',
            rank: 1,
            weight: 5,
            kind: 'state',
            answer: { idPrefix: 'app.orders.row' },
            need: 'all',
            form: { rows: 3, lines: 1 },
          }),
          ask({
            id: 'B2',
            rank: 2,
            weight: 1,
            kind: 'reference',
            answer: { ids: ['app.help.p'] },
            form: { rows: 1, lines: 4 },
          }),
          ask({ id: 'B3', rank: 3, weight: 2, kind: 'lookup', answer: null }),
          ...extraAsks.map(ask),
        ],
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
  return parsed.value;
}

/** Floors every compaction test plans against. */
export const PLAN_FLOORS = {
  fontPx: 12,
  lineHeightRatio: 1.25,
  targetPx: 24,
  rowPadPx: 4,
} as const;
