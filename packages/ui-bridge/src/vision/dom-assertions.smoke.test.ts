// @vitest-environment node
/**
 * Real-Chromium proof of the in-tab vision assertions (plan
 * 2026-11-09-ui-bridge-relay-evaluates-vision-assertions-in-the-tab, Phase 1).
 *
 * jsdom does no layout, paints nothing and has no hit test, so a jsdom-only
 * test of these five kinds would be green with the measurement broken. Every
 * case here measures a real page: `vision/dom-assertions.ts` is bundled from
 * source with esbuild (with the real `UIBridgeRegistry`) and injected, the
 * fixture's `[data-id]` elements are registered, and the request goes through
 * the same `evaluateVisionAssertions` both SDK transports call.
 *
 * Each kind has at least one passed, one failed and one unknown case, and each
 * case asserts its code (none on a verdict).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright';
import { chromiumAvailable } from '../../../../test-support/chromium-gate.mjs';
import { MAX_VISION_ASSERTIONS } from './assertion-request';
import type { VisionAssertResponse } from './wire';

const PLAYWRIGHT_AVAILABLE = chromiumAvailable();

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');

let browser: Browser;
let bundle: string;

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    VA: any;
  }
}

beforeAll(async () => {
  if (!PLAYWRIGHT_AVAILABLE) return;
  const out = await build({
    stdin: {
      contents: `
        import { evaluateVisionAssertions } from './vision/dom-assertions';
        import { UIBridgeRegistry } from './core/registry';
        export function run(request) {
          const registry = new UIBridgeRegistry();
          for (const el of Array.from(document.querySelectorAll('[data-id]'))) {
            registry.registerElement(el.getAttribute('data-id'), el, { type: 'generic' });
          }
          return evaluateVisionAssertions(registry, request);
        }
      `,
      resolveDir: SRC,
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    globalName: 'VA',
    platform: 'browser',
    target: 'chrome120',
    write: false,
    logLevel: 'silent',
    define: { __SDK_VERSION__: '"smoke"', 'process.env.NODE_ENV': '"test"' },
  });
  bundle = out.outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
}, 120_000);

/** Open `body` (on a white, light-scheme page) with the evaluator injected. */
async function openPage(body: string, viewport = { width: 800, height: 600 }): Promise<Page> {
  const page = await browser.newPage({ viewport });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:8px">${body}</body></html>`
  );
  await page.addScriptTag({ content: bundle });
  return page;
}

async function assertOn(page: Page, assertions: unknown[]): Promise<VisionAssertResponse> {
  return page.evaluate((request) => window.VA.run(request), { assertions });
}

/** `[outcome, code]` per result: a verdict carries no code, an unknown carries exactly one. */
function verdicts(res: VisionAssertResponse): Array<[string, string | null]> {
  return res.results.map((r) => [r.outcome, r.code ?? null]);
}

const PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe.skipIf(!PLAYWRIGHT_AVAILABLE)('vision assertions in the tab (real Chromium)', () => {
  it('contrast_meets_wcag: composited colours, large text, and what the DOM cannot read', async () => {
    const page = await openPage(`
      <p data-id="ok" style="color:#000;background:#fff">Readable</p>
      <p data-id="faint" style="color:#999">Faint grey on white</p>
      <p data-id="big" style="color:#949494;font-size:24px;margin:0">Large text</p>
      <p data-id="small" style="color:#949494;font-size:16px">Small text</p>
      <p data-id="okl" style="color:oklch(0.2 0 0);background:oklch(0.98 0 0)">Tailwind v4 colours</p>
      <div style="background:#000"><p data-id="veil" style="color:#fff;background:rgba(255,255,255,0.5)">Veiled</p></div>
      <div style="background:#fff"><p data-id="muted" style="color:#000;opacity:0.3">Muted by opacity</p></div>
      <div style="background:linear-gradient(red, blue)"><p data-id="grad" style="color:#fff">Over a gradient</p></div>
      <div style="opacity:0.5;background:#fff"><p data-id="faded" style="color:#000">Faded group</p></div>
      <div style="position:relative;width:240px;height:40px">
        <img src="${PIXEL_PNG}" style="display:block;width:240px;height:40px">
        <p data-id="caption" style="position:absolute;top:0;left:0;margin:0;color:#fff">Caption over an image</p>
      </div>
      <p data-id="nopointer" style="color:#000;pointer-events:none">Not hit-testable</p>
      <p data-id="below" style="position:absolute;top:2000px;color:#000">Below the fold</p>
    `);
    const res = await assertOn(
      page,
      [
        'ok',
        'faint',
        'big',
        'small',
        'okl',
        'veil',
        'muted',
        'grad',
        'faded',
        'caption',
        'nopointer',
        'below',
        'absent',
      ].map((element) => ({ type: 'contrast_meets_wcag', element }))
    );
    expect(verdicts(res)).toEqual([
      ['passed', null], // 21:1
      ['failed', null], // #999 on white: 2.85:1
      ['passed', null], // 3.03:1 passes AA for 24px (large) text...
      ['failed', null], // ...and fails it for 16px text
      ['passed', null], // oklch() read from the computed style
      ['failed', null], // white text on 50% white over black: ~3.95:1
      ['failed', null], // black at opacity 0.3 over white: ~2.1:1
      ['unknown', 'input_missing'], // a background-image under the text
      ['unknown', 'input_missing'], // an opacity group containing the opaque layer
      ['unknown', 'input_missing'], // an <img>'s pixels under the text
      ['unknown', 'hit_test_unmeasurable'], // pointer-events: none
      ['unknown', 'hit_test_unmeasurable'], // outside the viewport; never scrolled
      ['unknown', 'input_missing'], // not registered
    ]);
    expect(res.results[0].detail).toContain('contrast ratio 21.00:1');
    expect(res.results[1].detail).toContain('contrast ratio 2.85:1 below WCAG Aa minimum 4.5:1');
    expect(res.results[2].detail).toContain('needs 3.0:1 for large text');
    expect(res.results[3].detail).toContain('minimum 4.5:1 for normal text');
    expect(res.results[5].detail).toMatch(/contrast ratio 3\.9\d:1/);
    expect(res.results[6].detail).toMatch(/contrast ratio 2\.1\d:1/);
    expect(res.results[7].detail).toContain('background-image');
    expect(res.results[8].detail).toContain('opacity 0.5');
    expect(res.results[9].detail).toContain('<img');
    expect(res.results[11].detail).toContain('outside the viewport');
    await page.close();
  }, 60_000);

  it('contrast_meets_wcag: an unreadable page background decides only where it shows through', async () => {
    const page = await openPage(`
      <div style="background:#fff"><p data-id="oncard" style="color:#000">On a white card</p></div>
      <p data-id="onpage" style="color:#000">On the textured page</p>
    `);
    await page.evaluate(() => {
      document.body.style.backgroundImage = 'linear-gradient(#000, #fff)';
    });
    const res = await assertOn(page, [
      { type: 'contrast_meets_wcag', element: 'oncard' },
      { type: 'contrast_meets_wcag', element: 'onpage' },
    ]);
    expect(verdicts(res)).toEqual([
      ['passed', null], // the opaque card covers the page background
      ['unknown', 'input_missing'],
    ]);
    expect(res.results[1].detail).toContain('the page background image');
    await page.close();
  }, 60_000);

  it('contrast_meets_wcag: a layer painted over the text, and an element with no text, are unknown', async () => {
    const page = await openPage(`
      <div style="position:relative;width:300px;height:40px">
        <p data-id="scrimmed" style="color:#000;background:#fff;margin:0">Under a scrim</p>
        <div style="position:absolute;inset:0;background:rgba(255,255,255,0.8)"></div>
      </div>
      <div style="position:relative;width:300px;height:40px">
        <p data-id="covered" style="color:#000;margin:0">Under a sticky header</p>
        <div style="position:absolute;inset:0;background:#fff"></div>
      </div>
      <div style="position:relative;width:300px;height:40px">
        <p data-id="glass" style="color:#000;margin:0">Under a clear overlay</p>
        <div style="position:absolute;inset:0"></div>
      </div>
      <button data-id="icon" style="width:40px;height:40px;color:#eee;background:#fff"><svg width="20" height="20"><circle cx="10" cy="10" r="8" fill="currentColor"/></svg></button>
      <div data-id="blank" style="width:50px;height:20px;color:#000"></div>
      <div style="position:relative;width:300px;height:40px">
        <p data-id="shadowed" style="color:#000;background:#fff;margin:0">Under a shadow-root scrim</p>
        <x-scrim style="position:absolute;inset:0;display:block"></x-scrim>
      </div>
      <div style="position:relative;width:300px;height:40px">
        <p data-id="deepshadow" style="color:#000;background:#fff;margin:0">Two shadow roots deep</p>
        <x-outer style="position:absolute;inset:0;display:block"></x-outer>
      </div>
      <div style="position:relative;width:300px;height:40px">
        <p data-id="closedshadow" style="color:#000;background:#fff;margin:0">Under a closed root</p>
        <x-closed style="position:absolute;inset:0;display:block"></x-closed>
      </div>
      <x-btn data-id="slotted" style="display:block;width:200px">Slotted label</x-btn>
      <x-label data-id="lightce" style="display:block;color:#000;background:#fff">Light-DOM component text</x-label>
      <div style="position:relative;width:300px;height:40px">
        <p data-id="ghosted" style="color:#000;background:#fff;margin:0">Under an invisible overlay</p>
        <div style="position:absolute;inset:0;background:rgba(0,0,0,0.6);opacity:0"></div>
      </div>
    `);
    await page.evaluate(() => {
      const host = document.querySelector('x-scrim')!;
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML =
        '<div style="position:absolute;inset:0;background:rgba(255,255,255,0.8)"></div>';
      const outer = document.querySelector('x-outer')!.attachShadow({ mode: 'open' });
      outer.innerHTML = '<x-inner style="position:absolute;inset:0;display:block"></x-inner>';
      outer.querySelector('x-inner')!.attachShadow({ mode: 'open' }).innerHTML =
        '<div style="position:absolute;inset:0;background:rgba(255,255,255,0.8)"></div>';
      document.querySelector('x-btn')!.attachShadow({ mode: 'open' }).innerHTML =
        '<button style="color:#fff;background:#777;font-size:16px"><slot></slot></button>';
      customElements.define('x-closed', class extends HTMLElement {});
      customElements.define('x-label', class extends HTMLElement {});
      document.querySelector('x-closed')!.attachShadow({ mode: 'closed' }).innerHTML =
        '<div style="position:absolute;inset:0;background:rgba(255,255,255,0.8)"></div>';
    });
    const res = await assertOn(
      page,
      [
        'scrimmed',
        'covered',
        'glass',
        'icon',
        'blank',
        'shadowed',
        'deepshadow',
        'closedshadow',
        'slotted',
        'lightce',
        'ghosted',
      ].map((element) => ({
        type: 'contrast_meets_wcag',
        element,
      }))
    );
    expect(verdicts(res)).toEqual([
      // Black under an 80% white scrim is #ccc on white: ~1.61:1, never the
      // 21:1 the text and its card alone would give.
      ['failed', null],
      ['unknown', 'input_missing'], // an opaque box hides the text
      ['passed', null], // a transparent overlay paints nothing: measured through it
      ['unknown', 'input_missing'], // icon-only: no text to measure
      ['unknown', 'input_missing'], // empty box
      ['failed', null], // the same scrim inside an open shadow root
      ['failed', null], // the same scrim two open shadow roots deep
      ['unknown', 'input_missing'], // a custom element with a closed shadow root
      ['unknown', 'input_missing'], // slotted text: the shadow <button> paints it, not the host
      ['passed', null], // a light-DOM custom element holding text is measured
      ['passed', null], // an opacity:0 overlay paints nothing
    ]);
    for (const i of [0, 5, 6]) expect(res.results[i].detail).toContain('contrast ratio 1.61:1');
    expect(res.results[1].detail).toContain('paints over the text');
    expect(res.results[1].detail).toContain('with an opaque background');
    expect(res.results[3].detail).toContain('no rendered text');
    expect(res.results[7].detail).toContain('no open shadow root');
    await page.close();
  }, 60_000);

  it('contrast_meets_wcag: a fixed scrim over the text tints the text and its backdrop', async () => {
    const page = await openPage(`
      <p data-id="scrimmed" style="color:#000">Black text under a white scrim</p>
      <div style="position:fixed;inset:0;background:rgba(255,255,255,0.8)"></div>
    `);
    const res = await assertOn(page, [{ type: 'contrast_meets_wcag', element: 'scrimmed' }]);
    // Black under 80% white is #ccc on white: ~1.61:1, never the 21:1 the
    // text and the page alone would give.
    expect(verdicts(res)).toEqual([['failed', null]]);
    expect(res.results[0].detail).toContain('contrast ratio 1.61:1');
    await page.close();
  }, 60_000);

  it('contrast_meets_wcag: the layers painted above the text', async () => {
    const page = await openPage(`
      <div style="position:relative;height:50px;background:#000"><p data-id="tinted" style="margin:0;color:#fff">Under a translucent sheet</p><div style="position:absolute;inset:0;background:rgba(255,255,255,0.5)"></div></div>
      <div style="position:relative;height:50px"><p data-id="faded" style="margin:0;color:#000">Under a faded white sheet</p><div style="position:absolute;inset:0;background:#fff;opacity:0.8"></div></div>
      <div style="position:relative;height:50px"><p data-id="covered" style="margin:0;color:#000">Under an opaque sheet</p><div class="sheet" style="position:absolute;inset:0;background:#fff"></div></div>
      <div style="position:relative;height:50px"><p data-id="pictured" style="margin:0;color:#000">Under an image</p><img src="${PIXEL_PNG}" style="position:absolute;left:0;top:0;width:300px;height:50px;opacity:0.5"></div>
      <div style="position:relative;height:50px"><p data-id="linked" style="margin:0;color:#000;background:#fff">Under an empty stretched link</p><a href="#" style="position:absolute;inset:0"></a></div>
      <div style="position:relative;z-index:0;height:50px;background:#000"><div style="position:relative;height:50px;background:rgba(255,255,255,0.5)"><p data-id="sunk" style="position:relative;z-index:-1;margin:0;color:#fff">Beneath its own translucent card</p></div></div>
    `);
    const res = await assertOn(
      page,
      ['tinted', 'faded', 'covered', 'pictured', 'linked', 'sunk'].map((element) => ({
        type: 'contrast_meets_wcag',
        element,
      }))
    );
    expect(verdicts(res)).toEqual([
      ['failed', null], // white on black under a 50% white sheet: #fff on #808080, ~3.95:1
      ['failed', null], // an opaque white sheet at opacity 0.8: the same tint as an 80% scrim
      ['unknown', 'input_missing'], // an opaque layer covers the text
      ['unknown', 'input_missing'], // an image's pixels cover the text
      ['passed', null], // a transparent link over the card paints nothing
      // z-index: -1 sinks the text beneath its own parent's 50% white card,
      // which therefore tints it once, from above: #fff on #808080, ~3.95:1.
      // Counted beneath the text as well, the card would read ~1.84:1.
      ['failed', null],
    ]);
    expect(res.results[0].detail).toMatch(/contrast ratio 3\.9\d:1/);
    expect(res.results[1].detail).toContain('contrast ratio 1.61:1');
    expect(res.results[2].detail).toContain('<div.sheet> paints over the text at');
    expect(res.results[2].detail).toContain(
      'with an opaque background (rgb(255, 255, 255)) that covers it'
    );
    expect(res.results[3].detail).toContain('<img> paints over the text at');
    expect(res.results[3].detail).toContain('with pixels the DOM cannot read');
    expect(res.results[4].detail).toContain('contrast ratio 21.00:1');
    expect(res.results[5].detail).toMatch(/contrast ratio 3\.9\d:1/);
    await page.close();
  }, 60_000);

  it('contrast_meets_wcag: layers above the text composite in paint order', async () => {
    const page = await openPage(`
      <div style="position:relative;height:50px;background:#fff"><p data-id="twosheets" style="margin:0;color:#000">Under two sheets</p><div style="position:absolute;inset:0;background:rgba(0,0,0,0.5)"></div><div style="position:absolute;inset:0;background:rgba(255,255,255,0.5)"></div></div>
      <div style="position:relative;height:50px;background:#fff"><p data-id="tintedhost" style="margin:0;color:#000">Under a tinted host</p><x-tint style="position:absolute;inset:0;display:block;background:rgba(0,0,0,0.5)"></x-tint></div>
    `);
    await page.evaluate(() => {
      document.querySelector('x-tint')!.attachShadow({ mode: 'open' }).innerHTML =
        '<div style="position:absolute;inset:0;background:rgba(255,255,255,0.5)"></div>';
    });
    const res = await assertOn(
      page,
      ['twosheets', 'tintedhost'].map((element) => ({ type: 'contrast_meets_wcag', element }))
    );
    // A 50% black sheet, then a 50% white one above it: the text is #808080
    // on #bfbfbf, ~2.15:1. Composited the other way round it would be
    // #404040 on #808080, ~2.62:1. A shadow root's content paints over its
    // host's own background, so the host's black is the lower sheet.
    expect(verdicts(res)).toEqual([
      ['failed', null],
      ['failed', null],
    ]);
    expect(res.results[0].detail).toContain('contrast ratio 2.15:1');
    expect(res.results[1].detail).toContain('contrast ratio 2.15:1');
    await page.close();

    // White text sunk beneath the body (z-index: -1): the body's black is
    // propagated to the canvas, beneath everything, so the body above the
    // text paints nothing over it.
    const sunk = await openPage(`
      <style>body { background: #000 }</style>
      <p data-id="underbody" style="position:relative;z-index:-1;color:#fff">Beneath the body</p>
    `);
    const sunkRes = await assertOn(sunk, [{ type: 'contrast_meets_wcag', element: 'underbody' }]);
    expect(verdicts(sunkRes)).toEqual([['passed', null]]);
    expect(sunkRes.results[0].detail).toContain('contrast ratio 21.00:1');
    await sunk.close();
  }, 60_000);

  it('contrast_meets_wcag: a layer above the text that paints its own text or generated content', async () => {
    const page = await openPage(`
      <style>
        .tint::before { content: ""; position: absolute; left: 0; top: 0; width: 300px; height: 50px; background: rgba(255, 0, 0, 0.5) }
        .aside::before { content: ""; position: absolute; left: 400px; top: 0; width: 50px; height: 50px; background: rgba(255, 0, 0, 0.5) }
        .glyph::before { content: "*" }
      </style>
      <div style="position:relative;height:50px;background:#fff"><p data-id="lettered" style="margin:0;color:#000">Under a lettered overlay</p><div class="letters" style="position:absolute;inset:0;color:#c00">Under a lettered overlay</div></div>
      <div style="position:relative;height:50px;background:#fff"><p data-id="letteredaside" style="margin:0;color:#000">Under an overlay lettered lower down</p><div style="position:absolute;inset:0;padding-top:30px;color:#c00">Lower down</div></div>
      <div style="position:relative;height:50px;background:#fff"><p data-id="genned" style="margin:0;color:#000">Under generated content</p><div class="tint" style="position:absolute;inset:0"></div></div>
      <div style="position:relative;height:50px;background:#fff"><p data-id="gennedaside" style="margin:0;color:#000">Beside generated content</p><div class="aside" style="position:absolute;inset:0"></div></div>
      <div style="position:relative;height:50px;background:#fff"><p data-id="gennedmaybe" style="margin:0;color:#000">Under a generated glyph</p><div class="glyph" style="position:absolute;inset:0"></div></div>
    `);
    const res = await assertOn(
      page,
      ['lettered', 'letteredaside', 'genned', 'gennedaside', 'gennedmaybe'].map((element) => ({
        type: 'contrast_meets_wcag',
        element,
      }))
    );
    // Each overlay is transparent, so its background paints nothing over the
    // text. What else it paints there decides: its own text or generated
    // content over the text is paint the DOM cannot read, while the same
    // overlay with its text lower down, or its generated box pinned beside
    // the text, leaves the text's own 21:1.
    expect(verdicts(res)).toEqual([
      ['unknown', 'input_missing'],
      ['passed', null],
      ['unknown', 'input_missing'],
      ['passed', null],
      ['unknown', 'input_missing'],
    ]);
    expect(res.results[0].detail).toContain('<div.letters> paints over the text at');
    expect(res.results[0].detail).toContain('with its own text at the same position');
    expect(res.results[1].detail).toContain('contrast ratio 21.00:1');
    expect(res.results[2].detail).toContain('<div.tint> paints over the text at');
    expect(res.results[2].detail).toContain('with ::before generated content that covers it');
    expect(res.results[3].detail).toContain('contrast ratio 21.00:1');
    // A glyph in normal flow has no box the computed style pins down.
    expect(res.results[4].detail).toContain('<div.glyph> paints over the text at');
    expect(res.results[4].detail).toContain('with ::before generated content that may cover it');
    await page.close();
  }, 60_000);

  it('text_fits_container: layout sizes under a transform, and redacted text is never echoed', async () => {
    const page = await openPage(`
      <div style="transform:scale(2);transform-origin:0 0;width:100px">
        <div data-id="up" style="width:100px;white-space:nowrap;overflow:hidden"><span style="display:inline-block;width:150px">x</span></div>
      </div>
      <div style="transform:scale(0.5);transform-origin:0 0;width:100px;margin-top:80px">
        <div data-id="down" style="width:100px;white-space:nowrap;overflow:hidden">Short</div>
      </div>
      <div data-id="row" style="width:60px;white-space:nowrap;overflow:hidden">Order total: <span data-bridge-redact="true">4111 1111 1111 1111</span> card</div>
      <div style="transform:scale(0.4);transform-origin:0 0;width:100px">
        <div data-id="tiny" style="width:100px;white-space:nowrap;overflow:hidden"><span style="display:inline-block;width:101px">x</span></div>
        <div data-id="tinyfit" style="width:100px;white-space:nowrap;overflow:hidden"><span style="display:inline-block;width:100px">x</span></div>
        <p style="width:100px;white-space:nowrap;overflow:hidden;margin:0"><span data-id="tinyinl"><span style="display:inline-block;width:101px">x</span></span></p>
      </div>
    `);
    const res = await assertOn(
      page,
      ['up', 'down', 'row', 'tiny', 'tinyfit', 'tinyinl'].map((element) => ({
        type: 'text_fits_container',
        element,
      }))
    );
    expect(verdicts(res)).toEqual([
      ['failed', null], // 150px of content in a 100px box, drawn at scale(2)
      ['passed', null], // fitting text drawn at scale(0.5)
      ['failed', null],
      // One pixel past a 100px box drawn at scale(0.4) is 0.4px on the page,
      // which compared in the drawn box would round away: both sides are
      // layout pixels, for a block and for an inline element's fragments.
      ['failed', null],
      ['passed', null], // exactly 100px of content
      ['failed', null],
    ]);
    expect(res.results[2].detail).not.toContain('4111');
    expect(res.results[2].detail).toContain('[REDACTED]');
    expect(res.results[3].detail).toContain('content is 101px wide but the box is only 100px');
    expect(res.results[5].detail).toContain('content is 101px wide but the box is only 100px');
    await page.close();
  }, 60_000);

  it('contrast_meets_wcag: a pointer-events: none layer the hit test cannot order', async () => {
    // Each case is one row; a row's layer reaches only its own text.
    const at = (top: number) => `position:absolute;left:8px;top:${top}px;margin:0;color:#000`;
    const veil = (top: number, rgba: string, left = 0) =>
      `position:fixed;left:${left}px;top:${top}px;width:400px;height:30px;background:${rgba}`;
    const page = await openPage(`
      <div style="position:absolute;left:0;top:0;width:400px;height:40px;background:#fff">
        <p data-id="carded" style="${at(10)}">Under a veil in its card</p>
        <div style="position:absolute;inset:0;background:rgba(0,0,0,0.3);pointer-events:none"></div>
      </div>
      <p data-id="portaled" style="${at(60)}">Under a veil mounted on the body</p>
      <div style="${veil(55, 'rgba(255,0,0,0.2)')};pointer-events:none"></div>
      <p data-id="rooted" style="${at(110)}">Under a veil in a zero-size portal root</p>
      <div style="position:absolute;left:0;top:0;width:0;height:0">
        <div style="${veil(105, 'rgba(0,128,0,0.2)')};pointer-events:none"></div>
      </div>
      <p data-id="wrapped" style="${at(160)}">Under a veil inside a pointer-events: none wrapper</p>
      <div style="position:absolute;left:500px;top:150px;width:50px;height:50px;pointer-events:none">
        <div style="${veil(155, 'rgba(0,0,255,0.2)')}"></div>
      </div>
      <p data-id="elsewhere" style="${at(210)}">A veil elsewhere on the page</p>
      <div style="${veil(205, 'rgba(0,0,0,0.5)', 600)};width:50px;pointer-events:none"></div>
      <div style="position:absolute;left:0;top:250px;width:400px;height:40px;background:#fff;pointer-events:none">
        <p data-id="held" style="margin:0;color:#000;pointer-events:auto">Inside a pointer-events: none card</p>
      </div>
    `);
    const res = await assertOn(
      page,
      ['carded', 'portaled', 'rooted', 'wrapped', 'elsewhere', 'held'].map((element) => ({
        type: 'contrast_meets_wcag',
        element,
      }))
    );
    expect(verdicts(res)).toEqual([
      ['unknown', 'input_missing'], // found below the card the hit test returned
      ['unknown', 'input_missing'], // found below the body
      ['unknown', 'input_missing'], // found through a wrapper with no area
      ['unknown', 'input_missing'], // found through a wrapper the hit test cannot see
      ['passed', null], // a veil that does not reach the text
      ['passed', null], // a pointer-events: none ancestor holds the text: it is the backdrop
    ]);
    for (const r of res.results.slice(0, 4)) {
      expect(r.detail).toContain(
        "paints a background at the text's position but computes pointer-events: none"
      );
    }
    expect(res.results[5].detail).toContain('contrast ratio 21.00:1');
    await page.close();
  }, 60_000);

  it('text_fits_container: a block-level element’s own box, borders and scrollbars excluded', async () => {
    const page = await openPage(`
      <div data-id="fits" style="width:300px">Short</div>
      <div data-id="trunc" style="width:60px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">A very long label that cannot fit</div>
      <div data-id="tall" style="width:80px;height:20px;overflow:hidden">Line one line two line three line four</div>
      <div data-id="bordered" style="width:100px;border:12px solid #000;overflow:hidden;white-space:nowrap"><span style="display:inline-block;width:106px">x</span></div>
      <p style="width:50px;white-space:nowrap;overflow:hidden"><span data-id="inl">long long long text</span></p>
      <div data-id="gone" style="display:none">Hidden text</div>
      <div data-id="empty" style="width:50px;height:20px"></div>
    `);
    const res = await assertOn(
      page,
      ['fits', 'trunc', 'tall', 'bordered', 'inl', 'gone', 'empty', 'absent'].map((element) => ({
        type: 'text_fits_container',
        element,
      }))
    );
    expect(verdicts(res)).toEqual([
      ['passed', null],
      ['failed', null], // horizontal: ellipsised
      ['failed', null], // vertical: wrapped lines taller than the box
      // Overflows its 100px client box by 6px — inside its 124px border box,
      // so comparing the raw scrollWidth with the border box would pass it.
      ['failed', null],
      ['failed', null], // an inline span whose own fragments overflow its block
      ['unknown', 'input_missing'], // display: none: no geometry
      ['unknown', 'input_missing'], // no text: nothing to fit
      ['unknown', 'input_missing'], // not registered
    ]);
    expect(res.results[1].detail).toContain('text is ellipsised');
    expect(res.results[2].detail).toContain('text overflows vertically');
    expect(res.results[2].detail).not.toContain('Line one'); // its size, never its text
    // In border-box terms: 106px of content + 24px of borders against a 124px box.
    expect(res.results[3].detail).toContain(
      'content is 130px wide but the box is only 124px (6px hidden)'
    );
    expect(res.results[5].detail).toContain('carries no geometry (bbox)');
    await page.close();
  }, 60_000);

  it('text_fits_container: an inline element by its own fragments, and fractional boxes', async () => {
    const page = await openPage(`
      <p style="width:80px;white-space:nowrap;overflow:hidden"><span data-id="shortinl">Hi</span> <span>a long sibling that overflows the line</span></p>
      <p style="width:120px;height:20px;line-height:20px;overflow:hidden"><span data-id="firstline">First</span> then a sibling that wraps onto lines the box hides</p>
      <p style="width:120px;height:20px;line-height:20px;overflow:hidden">Lead text that wraps <span data-id="wrapped">onto a hidden line</span></p>
      <p style="width:300px"><span data-id="zeroinl" style="font-size:0">gone</span> visible sibling text</p>
      <p style="width:300px"><b>Lead <span data-id="zeronested" style="font-size:0">gone</span></b></p>
      <p style="width:200px;font-size:16px;line-height:10px;padding:6px 0;overflow:hidden"><span data-id="padded">Tight lines</span></p>
      <div data-id="fractional" style="width:100.4px;white-space:nowrap;overflow:hidden"><span style="display:inline-block;width:100.9px">x</span></div>
      <div data-id="fractionalover" style="width:100.4px;white-space:nowrap;overflow:hidden"><span style="display:inline-block;width:101.6px">x</span></div>
    `);
    const res = await assertOn(
      page,
      [
        'shortinl',
        'firstline',
        'wrapped',
        'zeroinl',
        'zeronested',
        'padded',
        'fractional',
        'fractionalover',
      ].map((element) => ({ type: 'text_fits_container', element }))
    );
    expect(verdicts(res)).toEqual([
      ['passed', null], // the long sibling overflows the line, this label does not
      ['passed', null], // the block overflows vertically, but on later lines
      ['failed', null], // this span's text is on the lines the box hides
      ['unknown', 'input_missing'], // no fragment of its own, and the block holds more
      ['unknown', 'input_missing'], // the same, with the other text inside its wrapper
      // Its 16px font's content area reaches 3-4px past the 10px line, above
      // and below, into padding the block does not overflow: the block cuts
      // nothing, as measuring the <p> itself would also say.
      ['passed', null],
      // The 100.4px box reaches the evaluator unrounded and is 101px to the
      // fit, as the DOM's integer scrollWidth of 100.9px of content is.
      // offsetWidth would have handed it over as 100px, already rounded.
      ['passed', null],
      ['failed', null], // 101.6px of content is a scrollWidth of 102px
    ]);
    expect(res.results[2].detail).toContain('text overflows vertically');
    expect(res.results[3].detail).toContain("inline element 'zeroinl' exposes no box of its own");
    expect(res.results[4].detail).toContain(
      "inline element 'zeronested' exposes no box of its own"
    );
    expect(res.results[7].detail).toContain('content is 102px wide but the box is only 101px');
    await page.close();
  }, 60_000);

  it('no_overlap: border boxes, with the tolerance inset', async () => {
    const page = await openPage(`
      <div data-id="a" style="position:absolute;left:0;top:0;width:100px;height:100px"></div>
      <div data-id="b" style="position:absolute;left:96px;top:0;width:100px;height:100px"></div>
      <div data-id="c" style="position:absolute;left:300px;top:0;width:50px;height:50px"></div>
      <div data-id="hidden" style="display:none"></div>
      <div style="position:absolute;left:0;top:200px;width:100px;display:flex">
        <div data-id="third1" style="flex:1;height:20px"></div>
        <div data-id="third2" style="flex:1;height:20px"></div>
        <div data-id="third3" style="flex:1;height:20px"></div>
      </div>
      <div data-id="sub1" style="position:absolute;left:0;top:300px;width:50.25px;height:10px"></div>
      <div data-id="sub2" style="position:absolute;left:50px;top:300px;width:50px;height:10px"></div>
      <div data-id="edge1" style="position:absolute;left:0.625px;top:320px;width:10.625px;height:10px"></div>
      <div data-id="edge2" style="position:absolute;left:11.25px;top:320px;width:5px;height:10px"></div>
    `);
    const res = await assertOn(page, [
      { type: 'no_overlap', elements: ['a', 'b'] },
      { type: 'no_overlap', elements: ['a', 'c'] },
      { type: 'no_overlap', elements: ['a', 'b'], tolerance_px: 5 },
      // Three 33.333px flex items only touch: geometry rounds to the nearest
      // pixel, never up.
      { type: 'no_overlap', elements: ['third1', 'third2'] },
      { type: 'no_overlap', elements: ['third2', 'third3'] },
      { type: 'no_overlap', elements: ['a', 'hidden'] },
      { type: 'no_overlap', elements: ['a', 'absent'] },
      // A quarter pixel of overlap rounds away: [0, 50) and [50, 100).
      { type: 'no_overlap', elements: ['sub1', 'sub2'] },
      // A shared fractional edge, 11.25, stays shared: each edge is rounded,
      // [1, 11) and [11, 16). Rounding the width on its own would end edge1
      // at 1 + 11 = 12, a pixel into edge2.
      { type: 'no_overlap', elements: ['edge1', 'edge2'] },
    ]);
    expect(verdicts(res)).toEqual([
      ['failed', null],
      ['passed', null],
      ['passed', null],
      ['passed', null],
      ['passed', null],
      ['unknown', 'input_missing'],
      ['unknown', 'input_missing'],
      ['passed', null],
      ['passed', null],
    ]);
    expect(res.results[0].detail).toBe('a and b overlap by 400 px² (tolerance 0 px)');
    await page.close();
  }, 60_000);

  it('element_above: paint order from the hit test, never a CSS z-index', async () => {
    const page = await openPage(`
      <div data-id="panel" style="position:absolute;left:0;top:0;width:200px;height:200px;background:#eee;z-index:1"></div>
      <div data-id="menu" style="position:absolute;left:50px;top:50px;width:100px;height:100px;background:#333;z-index:5"></div>
      <div data-id="far" style="position:absolute;left:400px;top:0;width:50px;height:50px;background:#ccc"></div>
      <div data-id="ghostmenu" style="position:absolute;left:60px;top:60px;width:50px;height:50px;background:#f00;z-index:9;pointer-events:none"></div>
      <div data-id="deep" style="position:absolute;left:0;top:1000px;width:100px;height:100px;background:#0f0"></div>
      <div data-id="deeper" style="position:absolute;left:20px;top:1020px;width:100px;height:100px;background:#00f"></div>
      <div style="position:absolute;left:0;top:250px;width:400px">
        <div data-id="titlebar" style="position:relative;z-index:10;height:40px;background:#ddd">
          <div data-id="dropdown" style="position:absolute;top:30px;left:0;width:150px;height:120px;z-index:50;background:#fff"></div>
        </div>
        <div data-id="sidepanel" style="position:relative;z-index:20;height:200px;margin-top:-10px;background:#999"></div>
      </div>
    `);
    const res = await assertOn(page, [
      { type: 'element_above', elements: ['menu', 'panel'] },
      { type: 'element_above', elements: ['panel', 'menu'] },
      // The z-50 dropdown inside a z-10 title bar paints BELOW the z-20
      // panel: a CSS z-index comparison (50 > 20) would have said the opposite.
      { type: 'element_above', elements: ['dropdown', 'sidepanel'] },
      { type: 'element_above', elements: ['menu', 'far'] },
      { type: 'element_above', elements: ['menu', 'far'], require_overlap: false },
      { type: 'element_above', elements: ['ghostmenu', 'panel'] },
      { type: 'element_above', elements: ['deeper', 'deep'] },
      { type: 'element_above', elements: ['menu', 'absent'] },
    ]);
    expect(verdicts(res)).toEqual([
      ['passed', null],
      ['failed', null],
      ['failed', null],
      ['failed', null], // disjoint, and require_overlap defaults true
      ['unknown', 'hit_test_unmeasurable'], // disjoint: no point shows both
      ['unknown', 'hit_test_unmeasurable'], // pointer-events: none
      ['unknown', 'hit_test_unmeasurable'], // shared area below the viewport
      ['unknown', 'input_missing'],
    ]);
    expect(res.results[0].detail).toContain("'menu' paints above 'panel' at all 9 sample point(s)");
    expect(res.results[2].detail).toContain("finds 'sidepanel' painted above 'dropdown'");
    expect(res.results[5].detail).toContain('pointer-events: none');
    expect(res.results[6].detail).toContain('outside the viewport');
    await page.close();
  }, 60_000);

  it('no_clipping: the registry, against each element’s nearest clipping ancestor', async () => {
    const spilling = await openPage(`
      <div data-id="frame" style="position:relative;width:200px;height:100px;overflow:hidden;margin:20px">
        <div data-id="inside" style="width:100px;height:50px"></div>
        <div data-id="spill" style="width:300px;height:20px"></div>
      </div>
    `);
    const spill = await assertOn(spilling, [
      { type: 'no_clipping' },
      // A region touching only 'inside': its pair is compared, and it fits.
      { type: 'no_clipping', region: { x: 30, y: 30, w: 10, h: 10 } },
      { type: 'no_clipping', region: { x: 0, y: 0, w: 400, h: 400 } },
      // A region touching no element: no pair was compared.
      { type: 'no_clipping', region: { x: 500, y: 500, w: 50, h: 50 } },
    ]);
    expect(verdicts(spill)).toEqual([
      ['failed', null],
      ['passed', null], // the region scopes the offender out
      ['failed', null],
      ['unknown', 'input_missing'],
    ]);
    expect(spill.results[0].detail).toContain(
      "element 'spill' extends past the horizontal clip of 'frame'"
    );
    expect(spill.snapshotAttribution.state).toBe('attributed');
    expect(spill.provenance.producer).toEqual({ id: 'sdk/vision-assertions', version: 'smoke' });
    await spilling.close();

    const clean = await openPage(`
      <div data-id="card" style="width:200px;height:100px;overflow:hidden;margin:20px">
        <div data-id="row" style="width:150px;height:40px"></div>
        <div data-id="popover" style="position:absolute;left:150px;top:80px;width:200px;height:100px;background:#fff"></div>
      </div>
      <div style="width:50px;overflow:hidden"><div style="width:100px;height:5px"></div></div>
      <span style="overflow:hidden"><span data-id="inlinechild" style="display:inline-block;width:900px;height:5px"></span></span>
      <div data-id="contained" style="contain:paint;width:100px;height:100px;margin-top:150px">
        <div data-id="wide" style="width:150px;height:10px"></div>
      </div>
    `);
    const cleanRes = await assertOn(clean, [
      // The popover's containing block is the viewport, so the overflow:hidden
      // card does not clip it; the unregistered spill is not in the registry;
      // and overflow does not apply to an inline box, so the inline span
      // clips nothing.
      { type: 'no_clipping', region: { x: 0, y: 0, w: 800, h: 160 } },
      // contain: paint clips like overflow.
      { type: 'no_clipping' },
    ]);
    expect(verdicts(cleanRes)).toEqual([
      ['passed', null],
      ['failed', null],
    ]);
    expect(cleanRes.results[1].detail).toContain("element 'wide' extends past");
    expect(cleanRes.results[1].detail).toContain('contain: paint');
    await clean.close();

    // A scroll container does not clip what is scrolled out past its far
    // side: rows scrolled out of the list, below it and (scrolled by 40px)
    // above it, are reachable, so neither the list nor the hidden sheet
    // around it clips them; the sheet is compared with the list's own box,
    // which fits.
    const scrolled = await openPage(`
      <div data-id="sheet" style="width:240px;height:120px;overflow:hidden">
        <div data-id="list" style="height:100px;overflow-y:auto">
          <div data-id="row1" style="height:40px">Row 1</div>
          <div data-id="row2" style="height:40px">Row 2</div>
          <div data-id="row3" style="height:40px">Row 3</div>
          <div data-id="row4" style="height:40px">Row 4</div>
        </div>
      </div>
      <div data-id="short" style="width:240px;height:80px;overflow:hidden;margin-top:100px">
        <div data-id="tall" style="height:100px;overflow-y:auto"><div style="height:300px"></div></div>
      </div>
    `);
    await scrolled.evaluate(() => {
      document.querySelector('[data-id="list"]')!.scrollTop = 40;
    });
    const scrolledRes = await assertOn(scrolled, [
      { type: 'no_clipping', region: { x: 0, y: 0, w: 800, h: 130 } },
      { type: 'no_clipping' },
    ]);
    expect(verdicts(scrolledRes)).toEqual([
      ['passed', null],
      ['failed', null], // the outer clip still cuts the scroll container's own box
    ]);
    expect(scrolledRes.results[1].detail).toContain(
      "element 'tall' extends past the vertical clip of 'short'"
    );
    await scrolled.close();

    // What overflows the edge a scroll container scrolls from is out of reach
    // at every scroll position, so it is clipped: a badge pulled above the top
    // of a wrapper that scrolls for its width (overflow-y computes to auto),
    // and, right to left, one pulled past the right edge. The far side stays
    // reachable: a right-to-left row overflows to the left, and a reversed
    // column (a chat log) to the top.
    const origins = await openPage(`
      <div data-id="wrap" style="overflow-x:auto;width:300px;margin-top:40px">
        <div style="position:relative;height:30px">Card<span data-id="badge" style="position:absolute;top:-10px;left:40px;width:20px;height:16px"></span></div>
      </div>
      <div data-id="rtl" style="overflow-x:auto;direction:rtl;width:300px;height:40px;margin-top:60px">
        <div data-id="rtlrow" style="width:600px;height:20px"></div>
      </div>
      <div data-id="rtlbox" style="overflow-x:auto;direction:rtl;width:300px;height:40px;margin-top:60px">
        <div style="position:relative;height:20px"><span data-id="rtlbadge" style="position:absolute;right:-10px;width:20px;height:10px"></span></div>
      </div>
      <div data-id="chat" style="display:flex;flex-direction:column-reverse;overflow-y:auto;width:300px;height:100px;margin-top:120px">
        <div data-id="msg1" style="flex:none;height:40px">1</div>
        <div data-id="msg2" style="flex:none;height:40px">2</div>
        <div data-id="msg3" style="flex:none;height:40px">3</div>
      </div>
    `);
    // The first margin collapses with the body's: wrap 40-70 (badge 30-46),
    // rtl 130-170, rtlbox 230-270, chat 390-490 with msg3 overflowing above
    // it at 370-410. Each region holds one container.
    const originsRes = await assertOn(origins, [
      { type: 'no_clipping', region: { x: 0, y: 30, w: 800, h: 50 } },
      { type: 'no_clipping', region: { x: 0, y: 130, w: 800, h: 50 } },
      { type: 'no_clipping', region: { x: 0, y: 230, w: 800, h: 50 } },
      { type: 'no_clipping', region: { x: 0, y: 370, w: 800, h: 130 } },
    ]);
    expect(verdicts(originsRes)).toEqual([
      ['failed', null],
      ['passed', null],
      ['failed', null],
      ['passed', null],
    ]);
    expect(originsRes.results[0].detail).toContain(
      "element 'badge' extends past the top edge of the scrollable area of 'wrap' " +
        '(overflow-y: auto), which no scroll position reaches past'
    );
    expect(originsRes.results[2].detail).toContain(
      "element 'rtlbadge' extends past the right edge of the scrollable area of 'rtlbox'"
    );
    await origins.close();

    // One pixel past the clip is clipped: the clip is the padding box itself,
    // with no slack, and the evaluator rounds both boxes to the nearest pixel.
    const edge = await openPage(`
      <div data-id="edge" style="width:200px;height:50px;overflow:hidden">
        <div data-id="onepx" style="width:201px;height:10px"></div>
      </div>
      <div data-id="edge2" style="width:200px;height:50px;overflow:hidden">
        <div data-id="exact" style="width:200px;height:10px"></div>
      </div>
    `);
    const edgeRes = await assertOn(edge, [
      { type: 'no_clipping', region: { x: 0, y: 0, w: 800, h: 50 } },
      { type: 'no_clipping', region: { x: 0, y: 60, w: 800, h: 50 } },
    ]);
    expect(verdicts(edgeRes)).toEqual([
      ['failed', null],
      ['passed', null], // exactly as wide as the clip
    ]);
    expect(edgeRes.results[0].detail).toContain("element 'onepx' extends past");
    await edge.close();

    // Under a transform the clip is the FRACTIONAL padding box, scaled. A
    // 100.4px by 20.4px box at scale(2) is 200.8px by 40.8px, and a child
    // exactly its size fits it. Its integer client size (100px by 20px, so
    // 200px by 40px) would read as clipping that child by a pixel each way.
    const scaled = await openPage(`
      <div style="transform:scale(2);transform-origin:0 0;width:300px">
        <div data-id="scaledclip" style="width:100.4px;height:20.4px;overflow:hidden">
          <div data-id="scaledfill" style="width:100.4px;height:20.4px"></div>
        </div>
        <div data-id="scaledclip2" style="width:100.4px;height:20.4px;overflow:hidden;margin-top:10px">
          <div data-id="scaledover" style="width:101px;height:10px"></div>
        </div>
      </div>
    `);
    const scaledRes = await assertOn(scaled, [
      { type: 'no_clipping', region: { x: 0, y: 0, w: 800, h: 50 } },
      { type: 'no_clipping', region: { x: 0, y: 60, w: 800, h: 60 } },
    ]);
    expect(verdicts(scaledRes)).toEqual([
      ['passed', null],
      ['failed', null], // 101px at scale(2) is 202px, past the 200.8px clip
    ]);
    expect(scaledRes.results[1].detail).toContain(
      "element 'scaledover' extends past the horizontal clip of 'scaledclip2'"
    );
    await scaled.close();

    const unmeasured = await openPage(`<div data-id="gone" style="display:none"></div>`);
    expect(verdicts(await assertOn(unmeasured, [{ type: 'no_clipping' }]))).toEqual([
      ['unknown', 'input_missing'],
    ]);
    await unmeasured.close();
  }, 60_000);

  it('no_clipping: a right-to-left scroll container with its scrollbar on the left', async () => {
    // Playwright's Chromium hides scrollbars, so every other case here lays
    // out without one. A user's tab draws them, and under direction: rtl
    // Chromium draws the vertical one on the LEFT, where it pushes the
    // padding box right by its width. The right edge is the one this
    // container scrolls from, so a badge flush with it fits and one 5px past
    // it is cut off at every scroll position. Left to right, the scrollbar
    // is on the right, and a badge flush with the left edge fits.
    const shown = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
    try {
      const page = await shown.newPage({ viewport: { width: 800, height: 600 } });
      await page.setContent(
        `<!doctype html><html><body style="margin:8px">
          <div data-id="rtlv" style="direction:rtl;overflow-y:auto;width:200px;height:100px">
            <div style="position:relative;height:300px">
              <span data-id="flush" style="position:absolute;right:0;top:0;width:20px;height:10px"></span>
              <span data-id="past" style="position:absolute;right:-5px;top:20px;width:20px;height:10px"></span>
            </div>
          </div>
          <div data-id="ltrv" style="overflow-y:auto;width:200px;height:100px">
            <div style="position:relative;height:300px">
              <span data-id="flushleft" style="position:absolute;left:0;top:0;width:20px;height:10px"></span>
            </div>
          </div>
        </body></html>`
      );
      await page.addScriptTag({ content: bundle });
      // The scrollbars are drawn: on the left of the first container (with
      // no border, its clientLeft is the scrollbar), on the right of the
      // second.
      const bars = await page.evaluate(() =>
        ['rtlv', 'ltrv'].map((id) => {
          const el = document.querySelector(`[data-id="${id}"]`) as HTMLElement;
          return { left: el.clientLeft, width: el.offsetWidth - el.clientWidth };
        })
      );
      expect(bars[0].width).toBeGreaterThan(0);
      expect(bars).toEqual([
        { left: bars[0].width, width: bars[0].width },
        { left: 0, width: bars[0].width },
      ]);
      const res = await assertOn(page, [
        { type: 'no_clipping', region: { x: 0, y: 8, w: 800, h: 10 } },
        { type: 'no_clipping', region: { x: 0, y: 28, w: 800, h: 10 } },
        { type: 'no_clipping', region: { x: 0, y: 108, w: 800, h: 10 } },
      ]);
      expect(verdicts(res)).toEqual([
        ['passed', null],
        ['failed', null],
        ['passed', null],
      ]);
      expect(res.results[1].detail).toContain(
        "element 'past' extends past the right edge of the scrollable area of 'rtlv'"
      );
    } finally {
      await shown.close();
    }
  }, 60_000);

  it(`times 500 assertions on a 2000-node page: ${MAX_VISION_ASSERTIONS} fit the relay's 8 s`, async () => {
    // About 2000 nodes: 400 small cards, every one on screen, each a card, a
    // title, a price, a badge and an icon; all but the icon are registered.
    const cards = Array.from(
      { length: 400 },
      (_, i) =>
        `<div data-id="card${i}" class="card"><span data-id="title${i}" class="title">Item ${i}</span>` +
        `<span data-id="price${i}" class="price">$${i}.00</span>` +
        `<b data-id="badge${i}" class="badge">${i % 7 ? 'New' : 'Sale'}</b><i class="icon"></i></div>`
    );
    const page = await openPage(
      `<style>
        .grid { display: grid; grid-template-columns: repeat(20, 60px); gap: 2px }
        .card { position: relative; height: 34px; background: #fff; border: 1px solid #ccc;
                overflow: hidden; font: 9px/11px sans-serif }
        .title, .price { display: block; color: #222 }
        .badge { position: absolute; right: 1px; bottom: 1px; background: #b00; color: #fff;
                 font-size: 8px }
        .icon { position: absolute; left: 1px; bottom: 1px; width: 6px; height: 6px;
                background: #08c }
      </style><div class="grid">${cards.join('')}</div>`,
      { width: 1280, height: 800 }
    );
    expect(await page.evaluate(() => document.getElementsByTagName('*').length)).toBeGreaterThan(
      2000
    );

    const n = (k: number): number[] => Array.from({ length: k }, (_, i) => i);
    const mixed = [
      ...n(200).map((i) => ({ type: 'contrast_meets_wcag', element: `title${i}` })),
      ...n(40).map((i) => ({ type: 'contrast_meets_wcag', element: `badge${i}` })),
      ...n(100).map((i) => ({ type: 'text_fits_container', element: `price${i}` })),
      ...n(100).map((i) => ({ type: 'no_overlap', elements: [`card${i}`, `card${i + 1}`] })),
      ...n(50).map((i) => ({ type: 'element_above', elements: [`badge${i}`, `card${i}`] })),
      ...n(5).map(() => ({ type: 'no_clipping' })),
      ...n(5).map(() => ({ type: 'animation_settled' })),
    ];
    // The costliest kind alone, each on a different element: nothing is reused.
    const contrast = [
      ...n(400).map((i) => ({ type: 'contrast_meets_wcag', element: `title${i}` })),
      ...n(100).map((i) => ({ type: 'contrast_meets_wcag', element: `price${i}` })),
    ];
    const timed = (assertions: unknown[]) =>
      page.evaluate(
        (request) => {
          const t0 = performance.now();
          const res = window.VA.run(request) as VisionAssertResponse;
          return { res, ms: performance.now() - t0 };
        },
        { assertions }
      );

    // Cold, as a tab's first request is. An empty request times what every
    // request pays once whatever its size: the registry snapshot that
    // attributes it, and the envelope.
    const fixedBefore = await timed([]);
    const mixedRun = await timed(mixed);
    const contrastRun = await timed(contrast);
    const fixedAfter = await timed([]);
    expect(mixed).toHaveLength(500);
    expect(contrast).toHaveLength(500);
    // Every result is a verdict but the five kinds the tab does not implement:
    // the time is the time to measure, not to give up.
    expect(mixedRun.res.outcomeCounts.unknown).toBe(5);
    expect(contrastRun.res.outcomeCounts.unknown).toBe(0);
    expect(fixedBefore.res.snapshotAttribution.state).toBe('attributed');

    const fixed = Math.max(fixedBefore.ms, fixedAfter.ms);
    const floor = Math.min(fixedBefore.ms, fixedAfter.ms);
    const perAssertion = (Math.max(mixedRun.ms, contrastRun.ms) - floor) / 500;
    const largest = fixed + perAssertion * MAX_VISION_ASSERTIONS + 500;
    console.info(
      `[vision timing] fixed ${fixedBefore.ms.toFixed(0)}/${fixedAfter.ms.toFixed(0)} ms, ` +
        `500 mixed ${mixedRun.ms.toFixed(0)} ms, 500 contrast ${contrastRun.ms.toFixed(0)} ms: ` +
        `${perAssertion.toFixed(3)} ms per assertion; ${MAX_VISION_ASSERTIONS} assertions ` +
        `${largest.toFixed(0)} ms with the 500 ms settle`
    );
    // The largest batch the validator admits, at the slower rate, on top of the
    // fixed cost and the tab's 500 ms settle wait, inside the relay's 8 s.
    expect(largest).toBeLessThan(8_000);
    await page.close();
  }, 120_000);

  it('answers a mixed batch per result, with the envelope vision/wire.ts declares', async () => {
    const page = await openPage(`<p data-id="ok" style="color:#000">Readable</p>`);
    const res = await assertOn(page, [
      { type: 'contrast_meets_wcag', element: 'ok' },
      { type: 'animation_settled' },
    ]);
    expect(verdicts(res)).toEqual([
      ['passed', null],
      ['unknown', 'capability_unavailable_in_build'],
    ]);
    expect(res.outcome).toBe('unknown');
    expect(res.unknownCodes).toEqual(['capability_unavailable_in_build']);
    expect(res.frame.status).toBe('unknown');
    expect(res.coverage).toMatchObject({ elements: 1, withGeometry: 1 });
    await page.close();
  }, 60_000);
});
