import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scanDOMForInteractiveElementsWithRefs } from '../server/dom-fallback';
import { applyCanonicalFindFilter } from './find-filter';

/**
 * Cost of `include_hidden: false` over a 2,000-element page — plan
 * `2026-11-24-ui-bridge-find-visibility-and-fallback-label-read-the-canonical-verdicts`,
 * Phase 3 (the risk that the occlusion hit-test is now on the filter's path).
 *
 * Two shapes, one per D1 table row the arms take:
 *  - `fallback find`: the server handler's DOM-fallback arm — the scan, then
 *    the filter over rows that already carry `state.visible` (D1 row 1, so the
 *    filter reads the row's own field and recomputes nothing).
 *  - `live-node rows`: the filter alone over rows with a live node and no
 *    `state` — the registry / React `find` arm (D1 row 2,
 *    `readElementVisibility`, which runs the hit-test per row).
 *
 * Fixture as `server/dom-fallback.discovery-cost.test.ts`: every element has a
 * laid-out, in-viewport 100x20 rect, `offsetParent` set (so the pre-D1
 * `offsetParent` check also keeps it), and an O(1) grid-indexed
 * `elementFromPoint` stub.
 *
 * Measurement only: skipped unless `UIB_MEASURE_FALLBACK_COST=1`. Run:
 *   UIB_MEASURE_FALLBACK_COST=1 npx vitest run src/core/find-filter.visible-cost.test.ts
 *
 * SCOPE OF ANY NUMBER IT PRINTS: jsdom with a STUBBED, O(1) `elementFromPoint`.
 * It is NOT a browser hit-test cost; a real `elementFromPoint` does layout and
 * stacking work this stub skips. No result is recorded here.
 */
const MEASURE = process.env.UIB_MEASURE_FALLBACK_COST === '1';
const RUNS = 7;
const COUNT = 2000;
const W = 100;
const H = 20;
const COLS = 12; // 12 * 100 = 1200 < innerWidth 1280

const realElementFromPoint = document.elementFromPoint;
let grid = new Map<string, HTMLElement>();

function buildFixture(): void {
  document.body.innerHTML = '';
  grid = new Map();
  for (let i = 0; i < COUNT; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = col * W;
    const y = row * H;
    const el = document.createElement('button');
    el.textContent = `Button ${i}`;
    el.getBoundingClientRect = () =>
      ({
        x,
        y,
        width: W,
        height: H,
        top: y,
        left: x,
        right: x + W,
        bottom: y + H,
        toJSON: () => ({}),
      }) as DOMRect;
    Object.defineProperty(el, 'offsetParent', { configurable: true, get: () => document.body });
    document.body.appendChild(el);
    grid.set(`${col},${row}`, el);
  }
}

function median(run: () => number): { median: number; min: number; max: number } {
  run(); // warm-up
  const samples: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now();
    run();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return { median: samples[Math.floor(RUNS / 2)], min: samples[0], max: samples[RUNS - 1] };
}

function report(name: string, t: { median: number; min: number; max: number }): void {
  process.stdout.write(
    `[find-include-hidden-cost] ${name} n=${COUNT} median=${t.median.toFixed(1)}ms ` +
      `min=${t.min.toFixed(1)}ms max=${t.max.toFixed(1)}ms\n`
  );
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', {
    value: Math.ceil(COUNT / COLS) * H + H,
    configurable: true,
  });
  document.elementFromPoint = ((px: number, py: number) =>
    grid.get(`${Math.floor(px / W)},${Math.floor(py / H)}`) ??
    null) as typeof document.elementFromPoint;
  buildFixture();
});

afterEach(() => {
  document.elementFromPoint = realElementFromPoint;
  document.body.innerHTML = '';
});

describe.skipIf(!MEASURE)('include_hidden:false cost (measurement only)', () => {
  it(`fallback find over ${COUNT} elements`, () => {
    const t = median(() => {
      const rows = scanDOMForInteractiveElementsWithRefs();
      const kept = applyCanonicalFindFilter(rows, { include_hidden: false });
      expect(kept).toHaveLength(COUNT);
      return kept.length;
    });
    report('fallback-find', t);
  });

  it(`filter over ${COUNT} live-node rows with no state`, () => {
    const rows = Array.from(document.body.querySelectorAll<HTMLElement>('button')).map(
      (element, i) => ({ id: `b${i}`, element })
    );
    const t = median(() => {
      const kept = applyCanonicalFindFilter(rows, { include_hidden: false });
      expect(kept).toHaveLength(COUNT);
      return kept.length;
    });
    report('live-node-filter', t);
  });
});
