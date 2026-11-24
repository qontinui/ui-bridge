/**
 * A synthetic page for the measurement tests, laid out in DOCUMENT space and
 * captured scrolled (the snapshot's rects are viewport space, so every
 * non-fixed rect is shifted by `scrollY` here, as a browser would report it).
 * Measuring a capture taken scrolled is what shows the first screen is
 * document `y` in `[0, H)` and not whatever the viewport showed.
 *
 * Every id and text is synthetic (plan D5).
 *
 * Layout at 1280 x 800, document height 2400:
 *
 * - a fixed header, `[0, 64)`, full width;
 * - the orders section (`main/section[1]`): a heading and three value rows;
 * - optionally a promo article (`main/article`): two paragraphs and a price;
 * - the help section (`main/section[2]`): one paragraph.
 */

import { captureDensityFromSnapshot } from '../../capture-from-snapshot';
import { parseDensityTargets, type DensityCapture, type DensityTargets } from '../../schema';
import {
  DENSITY_TEST_PRODUCER,
  densityTestSnapshot,
  type DensityTestElementSpec,
  type DensityTestSnapshotSpec,
} from './snapshot-builder';

export const PAGE_SCROLL_Y = 300;

export interface MeasurePageOptions {
  /** Block order inside `main`; `help` always comes last. Default `['orders']`. */
  blocks?: Array<'orders' | 'promo'>;
  /** Top of the help paragraph; default 900, or 1510 when the promo is present. */
  helpY?: number;
  /** Multiply every font size and line height. */
  fontScale?: number;
  /** Distractor badges beside each order row. */
  distractors?: boolean;
  /** The order rows sit in a registered list container, and a toggle collapses it. */
  collapsible?: 'open' | 'closed';
  /** A fixed footer of this height on the bottom edge. */
  footerPx?: number;
  fixture?: string;
  scrollY?: number;
  extra?: DensityTestElementSpec[];
}

function font(px: number, lh: number, scale: number) {
  return { fontSize: `${px * scale}px`, lineHeight: `${lh * scale}px` };
}

/** The page's elements, rects in DOCUMENT space (shifted to viewport space by {@link measurePageSnapshot}). */
export function measurePageElements(o: MeasurePageOptions = {}): {
  elements: DensityTestElementSpec[];
  fixed: Set<string>;
} {
  const scale = o.fontScale ?? 1;
  const blocks = o.blocks ?? ['orders'];
  const elements: DensityTestElementSpec[] = [];
  const fixed = new Set<string>(['app.header']);
  elements.push({
    id: 'app.header',
    tag: 'header',
    xpath: '/html/body/header',
    rect: [0, 0, 1280, 64],
    styles: { position: 'fixed', ...font(16, 24, scale) },
    text: 'Synthetic Shop',
  });
  let y = 100;
  for (const b of blocks) {
    if (b === 'orders') {
      const s = '/html/body/main/section[1]';
      elements.push({
        id: 'app.orders.title',
        tag: 'h2',
        xpath: `${s}/h2`,
        rect: [16, y, 600, 30],
        styles: font(20, 30, scale),
        text: 'Open orders',
      });
      const rowsBase = o.collapsible ? `${s}/div` : s;
      if (o.collapsible) {
        elements.push({
          id: 'app.orders.toggle',
          tag: 'button',
          category: 'interactive',
          xpath: `${s}/button`,
          rect: [520, y, 96, 30],
          ariaExpanded: o.collapsible === 'open',
          styles: font(14, 20, scale),
          text: 'Orders',
        });
        elements.push({
          id: 'app.orders.list',
          tag: 'div',
          xpath: `${s}/div`,
          rect: [16, y + 40, 600, 80],
        });
      }
      for (let k = 1; k <= 3; k++) {
        elements.push({
          id: `app.orders.row${k}`,
          tag: 'span',
          xpath: `${rowsBase}/span[${k}]`,
          rect: [16, y + 40 + 30 * (k - 1), 600, 20],
          styles: font(13, 20, scale),
          text: '12,50',
          ...(o.collapsible === 'closed'
            ? { visible: false, visibilityReason: 'hidden' as const }
            : {}),
        });
        if (o.distractors) {
          elements.push({
            id: `app.orders.badge${k}`,
            tag: 'span',
            xpath: `${rowsBase}/em[${k}]`,
            rect: [700, y + 40 + 30 * (k - 1), 100, 20],
            styles: font(13, 20, scale),
            text: 'New',
          });
        }
      }
      y += 140;
    } else {
      const a = '/html/body/main/article';
      elements.push(
        {
          id: 'app.promo.p1',
          tag: 'p',
          xpath: `${a}/p[1]`,
          rect: [16, y, 600, 300],
          styles: font(16, 24, scale),
          text: 'Synthetic promo one',
        },
        {
          id: 'app.promo.p2',
          tag: 'p',
          xpath: `${a}/p[2]`,
          rect: [16, y + 300, 600, 260],
          styles: font(16, 24, scale),
          text: 'Synthetic promo two',
        },
        {
          id: 'app.promo.price',
          tag: 'span',
          xpath: `${a}/span`,
          rect: [16, y + 570, 600, 20],
          styles: font(11, 16, scale),
          text: '99',
        }
      );
      y += 610;
    }
  }
  const helpY = o.helpY ?? (blocks.includes('promo') ? 1510 : 900);
  elements.push({
    id: 'app.help.p',
    tag: 'p',
    xpath: '/html/body/main/section[2]/p',
    rect: [16, helpY, 600, 40],
    styles: font(16, 24, scale),
    text: 'Synthetic help text',
  });
  if (o.footerPx !== undefined) {
    elements.push({
      id: 'app.footer',
      tag: 'footer',
      xpath: '/html/body/footer',
      rect: [0, 800 - o.footerPx, 1280, o.footerPx],
      styles: { position: 'fixed', ...font(14, 20, scale) },
      text: 'Synthetic footer',
    });
    fixed.add('app.footer');
  }
  for (const e of o.extra ?? []) elements.push(e);
  return { elements, fixed };
}

/** The snapshot of the page, taken at `scrollY` (default {@link PAGE_SCROLL_Y}). */
export function measurePageSnapshot(
  o: MeasurePageOptions = {}
): ReturnType<typeof densityTestSnapshot> {
  const scrollY = o.scrollY ?? PAGE_SCROLL_Y;
  const { elements, fixed } = measurePageElements(o);
  const spec: DensityTestSnapshotSpec = {
    elements: elements.map((e) => {
      if (!e.rect || fixed.has(e.id)) return e;
      const [x, y, w, h] = e.rect;
      return { ...e, rect: [x, y - scrollY, w, h] };
    }),
    viewport: { scrollY, documentHeight: 2400 },
    relationships: o.collapsible
      ? [{ source: 'app.orders.toggle', target: 'app.orders.list', type: 'controls' }]
      : undefined,
  };
  return densityTestSnapshot(spec);
}

/** The buyer's targets: B1 the order rows (need all), B2 the help paragraph, B3 unanswered. */
export function measurePageTargets(extraAsks: Array<Record<string, unknown>> = []): DensityTargets {
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
          }),
          ask({ id: 'B2', rank: 2, weight: 1, kind: 'reference', answer: { ids: ['app.help.p'] } }),
          ask({ id: 'B3', rank: 3, weight: 2, kind: 'lookup', answer: null }),
          ...extraAsks.map(ask),
        ],
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
  return parsed.value;
}

/** Capture the page as the buyer. */
export function measurePageCapture(
  o: MeasurePageOptions = {},
  targets: DensityTargets | null = measurePageTargets()
): DensityCapture {
  const obs = captureDensityFromSnapshot(measurePageSnapshot(o), {
    producer: DENSITY_TEST_PRODUCER,
    role: 'buyer',
    fixture: o.fixture ?? null,
    targets,
    evaluatedAt: '2026-11-24T10:00:00.000Z',
  });
  if (obs.status !== 'measured') throw new Error(`expected measured, got ${JSON.stringify(obs)}`);
  return obs.value;
}
