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
async function openPage(body: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
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
      ['unknown', 'input_missing'], // a translucent scrim paints over the text
      ['unknown', 'input_missing'], // an opaque box hides the text
      ['passed', null], // a transparent overlay paints nothing: measured through it
      ['unknown', 'input_missing'], // icon-only: no text to measure
      ['unknown', 'input_missing'], // empty box
      ['unknown', 'input_missing'], // a scrim inside an open shadow root
      ['unknown', 'input_missing'], // a scrim two open shadow roots deep
      ['unknown', 'input_missing'], // a custom element with a closed shadow root
      ['unknown', 'input_missing'], // slotted text: the shadow <button> paints it, not the host
      ['passed', null], // a light-DOM custom element holding text is measured
      ['passed', null], // an opacity:0 overlay paints nothing
    ]);
    expect(res.results[0].detail).toContain('paints over the text');
    expect(res.results[3].detail).toContain('no rendered text');
    await page.close();
  }, 60_000);

  it('text_fits_container: extents are compared in the transformed box, and redacted text is never echoed', async () => {
    const page = await openPage(`
      <div style="transform:scale(2);transform-origin:0 0;width:100px">
        <div data-id="up" style="width:100px;white-space:nowrap;overflow:hidden"><span style="display:inline-block;width:150px">x</span></div>
      </div>
      <div style="transform:scale(0.5);transform-origin:0 0;width:100px;margin-top:80px">
        <div data-id="down" style="width:100px;white-space:nowrap;overflow:hidden">Short</div>
      </div>
      <div data-id="row" style="width:60px;white-space:nowrap;overflow:hidden">Order total: <span data-bridge-redact="true">4111 1111 1111 1111</span> card</div>
    `);
    const res = await assertOn(
      page,
      ['up', 'down', 'row'].map((element) => ({ type: 'text_fits_container', element }))
    );
    expect(verdicts(res)).toEqual([
      ['failed', null], // 150px of content in a 100px box, drawn at scale(2)
      ['passed', null], // fitting text drawn at scale(0.5)
      ['failed', null],
    ]);
    expect(res.results[2].detail).not.toContain('4111');
    expect(res.results[2].detail).toContain('[REDACTED]');
    await page.close();
  }, 60_000);

  it('text_fits_container: the nearest block box, borders and scrollbars excluded', async () => {
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
      ['failed', null], // an inline span, measured on its block box
      ['unknown', 'input_missing'], // display: none: no geometry
      ['unknown', 'input_missing'], // no text: nothing to fit
      ['unknown', 'input_missing'], // not registered
    ]);
    expect(res.results[1].detail).toContain('text is ellipsised');
    expect(res.results[2].detail).toContain('text overflows vertically');
    // In border-box terms: 106px of content + 24px of borders against a 124px box.
    expect(res.results[3].detail).toContain(
      'content is 130px wide but the box is only 124px (6px hidden)'
    );
    expect(res.results[5].detail).toContain('carries no geometry (bbox)');
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
    `);
    const res = await assertOn(page, [
      { type: 'no_overlap', elements: ['a', 'b'] },
      { type: 'no_overlap', elements: ['a', 'c'] },
      { type: 'no_overlap', elements: ['a', 'b'], tolerance_px: 5 },
      // Three 33.333px flex items only touch: geometry is never rounded up.
      { type: 'no_overlap', elements: ['third1', 'third2'] },
      { type: 'no_overlap', elements: ['third2', 'third3'] },
      { type: 'no_overlap', elements: ['a', 'hidden'] },
      { type: 'no_overlap', elements: ['a', 'absent'] },
    ]);
    expect(verdicts(res)).toEqual([
      ['failed', null],
      ['passed', null],
      ['passed', null],
      ['passed', null],
      ['passed', null],
      ['unknown', 'input_missing'],
      ['unknown', 'input_missing'],
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

    // A scroll container is not a clip: rows scrolled out of the list are
    // reachable, so neither the list nor the hidden sheet around it clips
    // them; the sheet is compared with the list's own box, which fits.
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

    const unmeasured = await openPage(`<div data-id="gone" style="display:none"></div>`);
    expect(verdicts(await assertOn(unmeasured, [{ type: 'no_clipping' }]))).toEqual([
      ['unknown', 'input_missing'],
    ]);
    await unmeasured.close();
  }, 60_000);

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
