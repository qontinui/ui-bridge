import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scanDOMForInteractiveElements } from './dom-fallback';

/**
 * Cost of DOM-fallback discovery over a 2,000-element page.
 *
 * Plan `2026-11-23-ui-bridge-element-state-collapse-follow-ups` D1 replaced the
 * fallback scan's private `offsetParent` + size `visible` with ONE
 * `getElementState` call per element, which adds the viewport and occlusion
 * arms (up to nine `elementFromPoint` hit-tests per element). This file
 * measures the scan on a fixed fixture.
 *
 * Every element gets a laid-out, in-viewport rect (100x20, so wide enough for
 * the full nine-point perimeter probe) and `elementFromPoint` is stubbed with
 * the topmost-box semantics of `core/element-state.parity.test.ts`, indexed by
 * grid cell so the stub's own cost does not grow with the fixture.
 *
 * Measurement only: skipped unless `UIB_MEASURE_FALLBACK_COST=1`, because
 * timings are not deterministic. Run:
 *   UIB_MEASURE_FALLBACK_COST=1 npx vitest run src/server/dom-fallback.discovery-cost.test.ts
 *
 * SCOPE OF ANY NUMBER IT PRINTS: a jsdom measurement with a STUBBED, O(1)
 * `elementFromPoint`. It is NOT a browser hit-test cost — a real
 * `elementFromPoint` does layout and stacking work this stub skips, so it
 * says nothing about how much the nine hit-tests per element cost in a
 * browser. No result is recorded here.
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
    document.body.appendChild(el);
    grid.set(`${col},${row}`, el);
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  // Tall enough that every row is in the viewport, so every element reaches
  // the hit-test arm (the expensive one) rather than leaving at `off-screen`.
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

describe.skipIf(!MEASURE)('DOM-fallback discovery cost (measurement only)', () => {
  it(`scans ${COUNT} fallback elements`, () => {
    expect(scanDOMForInteractiveElements()).toHaveLength(COUNT); // warm-up
    const samples: number[] = [];
    for (let r = 0; r < RUNS; r++) {
      const t0 = performance.now();
      const rows = scanDOMForInteractiveElements();
      samples.push(performance.now() - t0);
      expect(rows).toHaveLength(COUNT);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(RUNS / 2)];
    process.stdout.write(
      `[fallback-discovery-cost] n=${COUNT} median=${median.toFixed(1)}ms ` +
        `min=${samples[0].toFixed(1)}ms max=${samples[RUNS - 1].toFixed(1)}ms\n`
    );
  });
});
