// @vitest-environment node
/**
 * Real-Chromium proof of the forced pseudo-state primitive (plan
 * 2026-10-22-ui-bridge-hover-forces-the-css-hover-state, Phases 1-2).
 *
 * jsdom cannot parse CSS nesting or `@layer`, and has no `:hover` and no
 * transitions, so a jsdom-only test of the twin-rule rewrite would be green
 * with the feature broken. Every case here reads COMPUTED STYLE in a real
 * Chromium: the twin either makes the browser draw the hovered appearance or
 * the case fails.
 *
 * The module under test is bundled from source with esbuild (the same module
 * `action-executor.ts` and `react/commandHandlers.ts` import) and injected
 * into each page. The Tailwind fixture CSS is real Tailwind v4.2.4 output in
 * both shapes it ships: see `__fixtures__/tailwind-v4-hover.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright';
import { chromiumAvailable } from '../../../../test-support/chromium-gate.mjs';
import { TAILWIND_V4_BUILD_CSS, TAILWIND_V4_DEV_CSS } from './__fixtures__/tailwind-v4-hover';

const PLAYWRIGHT_AVAILABLE = chromiumAvailable();

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');

/** Files served by the same-origin server, by path. */
const files = new Map<string, { type: string; body: string }>();
/** Files served by the second (cross-origin) server. */
const foreignFiles = new Map<string, { type: string; body: string }>();

let server: Server;
let foreign: Server;
let origin: string;
let foreignOrigin: string;
let browser: Browser;
let bundle: string;

function serve(map: Map<string, { type: string; body: string }>): Server {
  return createServer((req, res) => {
    const file = map.get((req.url ?? '/').split('?')[0]);
    if (!file) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': file.type, 'cache-control': 'no-store' });
    res.end(file.body);
  });
}

async function listen(s: Server): Promise<string> {
  await new Promise<void>((done) => s.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

let pageSeq = 0;

/** Serve `html` (with `css` as /<name>.css when given) and open it with the module injected as `window.FH`. */
async function openPage(html: string, css: Record<string, string> = {}): Promise<Page> {
  pageSeq += 1;
  const name = `/p${pageSeq}`;
  for (const [file, body] of Object.entries(css)) {
    files.set(`/${file}`, { type: 'text/css', body });
  }
  files.set(name, {
    type: 'text/html; charset=utf-8',
    body: `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`,
  });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(`${origin}${name}`);
  await page.addScriptTag({ content: bundle });
  return page;
}

/** The fixture body: a `.group` row with a hover-revealed button, as in ZoneHoverActions. */
const GROUP_HTML = `
  <div class="group" id="g" data-id="cell">
    <span id="header" data-id="header">zone header</span>
    <button id="tool" data-id="tool"
      class="opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto hover:bg-[#ff0000] bg-[#0000ff] [&:hover]:underline">tool</button>
  </div>`;

const read = (page: Page, sel: string): Promise<{ opacity: string; pe: string }> =>
  page.evaluate((s) => {
    const cs = getComputedStyle(document.querySelector(s)!);
    return { opacity: cs.opacity, pe: cs.pointerEvents };
  }, sel);

/** Every rule in every readable sheet (adopted and shadow included) whose text names the attribute. */
const twinsLeft = (page: Page): Promise<number> =>
  page.evaluate(() => {
    let n = 0;
    const walk = (list: CSSRuleList): void => {
      for (const r of Array.from(list)) {
        if (r.cssText.includes('data-ui-bridge-pseudo-')) n += 1;
        const nested = (r as unknown as { cssRules?: CSSRuleList }).cssRules;
        if (nested) walk(nested);
        const imported = (r as CSSImportRule).styleSheet;
        if (imported) walk(imported.cssRules);
      }
    };
    const sheets: CSSStyleSheet[] = [
      ...(Array.from(document.styleSheets) as CSSStyleSheet[]),
      ...document.adoptedStyleSheets,
    ];
    for (const host of Array.from(document.querySelectorAll('*'))) {
      if (host.shadowRoot) {
        sheets.push(...(Array.from(host.shadowRoot.styleSheets) as CSSStyleSheet[]));
        sheets.push(...host.shadowRoot.adoptedStyleSheets);
      }
    }
    for (const s of sheets) {
      try {
        walk(s.cssRules);
      } catch {
        // cross-origin
      }
    }
    return n;
  });

const marksLeft = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      document.querySelectorAll('[data-ui-bridge-pseudo-hover],[data-ui-bridge-pseudo-active]')
        .length
  );

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    FH: any;
  }
}

beforeAll(async () => {
  if (!PLAYWRIGHT_AVAILABLE) return;
  const out = await build({
    stdin: {
      contents: `
        export * from './control/forced-hover';
        export { UIBridgeRegistry } from './core/registry';
        export { DefaultActionExecutor } from './control/action-executor';
        export const registryOf = () => ({
          getAllElements: () => Array.from(document.querySelectorAll('[data-id]')).map((element) => ({
            id: element.getAttribute('data-id'),
            element,
          })),
        });
      `,
      resolveDir: SRC,
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    globalName: 'FH',
    platform: 'browser',
    target: 'chrome120',
    write: false,
    logLevel: 'silent',
    define: { __SDK_VERSION__: '"smoke"', 'process.env.NODE_ENV': '"test"' },
  });
  bundle = out.outputFiles[0].text;
  server = serve(files);
  foreign = serve(foreignFiles);
  origin = await listen(server);
  foreignOrigin = await listen(foreign);
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  for (const s of [server, foreign]) {
    if (!s) continue;
    s.closeAllConnections();
    await new Promise<void>((done) => s.close(() => done()));
  }
}, 120_000);

describe.skipIf(!PLAYWRIGHT_AVAILABLE)('forcePseudoState (real Chromium)', () => {
  for (const [shape, css] of [
    ['dev (nested rule, @media nested inside, @layer utilities)', TAILWIND_V4_DEV_CSS],
    ['build (flattened @media (hover:hover) inside @layer utilities)', TAILWIND_V4_BUILD_CSS],
  ] as const) {
    it(`Tailwind v4 ${shape}: group-hover flips opacity and pointer-events on apply, and back on release`, async () => {
      const page = await openPage(GROUP_HTML);
      await page.addStyleTag({ content: css });
      expect(await read(page, '#tool')).toEqual({ opacity: '0', pe: 'none' });

      const report = await page.evaluate(async () =>
        window.FH.forcePseudoState(document.getElementById('header'), 'hover', {
          registry: window.FH.registryOf(),
        })
      );
      expect(await read(page, '#tool')).toEqual({ opacity: '1', pe: 'auto' });
      // group-hover:opacity-100, group-hover:pointer-events-auto, hover:bg-*, [&:hover]:underline
      expect(report.rulesCloned).toBe(4);
      expect(report.unreadableSheets).toBe(0);
      expect(report.complete).toBe(true);
      expect(report.settled).toBe(true);
      // The scan cost the plan's Risks section asked to have recorded: a
      // fixture this size walks in well under a frame.
      expect(report.scanMs).toBeLessThan(250);
      expect(report.markedElements).toBeGreaterThanOrEqual(3); // header, .group, body, html
      const tool = report.revealed.find((r: { id: string }) => r.id === 'tool');
      expect(tool.changes).toEqual(
        expect.arrayContaining([
          { property: 'opacity', before: '0', after: '1' },
          { property: 'pointer-events', before: 'none', after: 'auto' },
        ])
      );
      expect(tool.rect.width).toBeGreaterThan(0);

      const release = await page.evaluate(() => window.FH.releaseForcedPseudoState('explicit'));
      expect(release).toMatchObject({ released: true, restore: 'verified', rulesRemoved: 4 });
      expect(await read(page, '#tool')).toEqual({ opacity: '0', pe: 'none' });
      expect(await twinsLeft(page)).toBe(0);
      expect(await marksLeft(page)).toBe(0);
      await page.close();
    }, 30_000);
  }

  it('the hovered target itself takes its hover:* and [&:hover]:* styles; escaped class names are untouched', async () => {
    const page = await openPage(GROUP_HTML);
    await page.addStyleTag({ content: TAILWIND_V4_BUILD_CSS });
    // A rule whose class NAME contains an escaped ":hover" but no real pseudo-class.
    await page.addStyleTag({
      content: String.raw`.hover\:only-a-name { color: rgb(1, 2, 3); } .\[\&\:hover\]\:also-a-name { color: rgb(4, 5, 6); }`,
    });
    const report = await page.evaluate(async () =>
      window.FH.forcePseudoState(document.getElementById('tool'), 'hover')
    );
    expect(report.rulesCloned).toBe(4); // the two name-only rules are not twinned
    const s = await page.evaluate(() => {
      const cs = getComputedStyle(document.getElementById('tool')!);
      return { bg: cs.backgroundColor, deco: cs.textDecorationLine };
    });
    expect(s).toEqual({ bg: 'rgb(255, 0, 0)', deco: 'underline' });
    const twinSelectors = await page.evaluate(() => {
      const out: string[] = [];
      const walk = (list: CSSRuleList): void => {
        for (const r of Array.from(list)) {
          const st = (r as CSSStyleRule).selectorText;
          if (st && st.includes('data-ui-bridge-pseudo-hover')) out.push(st);
          const nested = (r as unknown as { cssRules?: CSSRuleList }).cssRules;
          if (nested) walk(nested);
        }
      };
      for (const sheet of Array.from(document.styleSheets)) walk(sheet.cssRules);
      return out;
    });
    expect(twinSelectors).toContain(
      String.raw`.\[\&\:hover\]\:underline[data-ui-bridge-pseudo-hover]`
    );
    expect(twinSelectors).toContain(
      String.raw`.hover\:bg-\[\#ff0000\][data-ui-bridge-pseudo-hover]`
    );
    await page.evaluate(() => window.FH.releaseForcedPseudoState());
    await page.close();
  }, 30_000);

  it('a top-level `.a:hover .b` rule', async () => {
    const page = await openPage(
      `<div class="a"><span id="t">t</span><i class="b" id="b">b</i></div>`
    );
    await page.addStyleTag({ content: `.b{opacity:0}.a:hover .b{opacity:1}` });
    const r = await page.evaluate(() =>
      window.FH.forcePseudoState(document.getElementById('t'), 'hover')
    );
    expect(r.rulesCloned).toBe(1);
    expect((await read(page, '#b')).opacity).toBe('1');
    await page.evaluate(() => window.FH.releaseForcedPseudoState());
    expect((await read(page, '#b')).opacity).toBe('0');
    await page.close();
  }, 30_000);

  it('a nested :hover rule whose own child also contains :hover is twinned once, never revisited', async () => {
    const page = await openPage(`<div class="p" id="p"><i class="c" id="c">c</i></div>`);
    await page.addStyleTag({
      content: `.c{opacity:0;pointer-events:none} .p { &:hover { .c { opacity: 1; } &:hover .c { pointer-events: auto; } } }`,
    });
    const r = await page.evaluate(() =>
      window.FH.forcePseudoState(document.getElementById('p'), 'hover')
    );
    expect(r.rulesCloned).toBe(1);
    expect(await read(page, '#c')).toEqual({ opacity: '1', pe: 'auto' });
    // Exactly one rule (the twin) carries the attribute at its top; its nested
    // child was rewritten inside it rather than twinned again.
    const twinTops = await page.evaluate(() => {
      const outer = document.styleSheets[0].cssRules[1] as unknown as { cssRules: CSSRuleList };
      return Array.from(outer.cssRules).map((x) => (x as CSSStyleRule).selectorText);
    });
    expect(twinTops).toEqual(['&:hover', '&[data-ui-bridge-pseudo-hover]']);
    await page.evaluate(() => window.FH.releaseForcedPseudoState());
    expect(await read(page, '#c')).toEqual({ opacity: '0', pe: 'none' });
    expect(await twinsLeft(page)).toBe(0);
    await page.close();
  }, 30_000);

  it(':active via forcePseudoState(target, "active")', async () => {
    const page = await openPage(`<button id="btn">b</button>`);
    await page.addStyleTag({
      content: `#btn{opacity:.5} #btn:active{opacity:1} #btn:hover{opacity:.25}`,
    });
    const r = await page.evaluate(() =>
      window.FH.forcePseudoState(document.getElementById('btn'), 'active')
    );
    expect(r.rulesCloned).toBe(1);
    expect(r.attribute).toBe('data-ui-bridge-pseudo-active');
    expect((await read(page, '#btn')).opacity).toBe('1');
    const rel = await page.evaluate(() => window.FH.releaseForcedPseudoState());
    expect(rel.restore).toBe('verified');
    expect((await read(page, '#btn')).opacity).toBe('0.5');
    await page.close();
  }, 30_000);

  it('@supports', async () => {
    const page = await openPage(`<div class="a" id="a"><i class="b" id="b">b</i></div>`);
    await page.addStyleTag({
      content: `.b{opacity:0} @supports (display: grid) { .a:hover .b { opacity: 1 } }`,
    });
    await page.evaluate(() => window.FH.forcePseudoState(document.getElementById('a'), 'hover'));
    expect((await read(page, '#b')).opacity).toBe('1');
    await page.evaluate(() => window.FH.releaseForcedPseudoState());
    expect((await read(page, '#b')).opacity).toBe('0');
    await page.close();
  }, 30_000);

  it('an @import-ed sheet', async () => {
    const page = await openPage(
      `<link rel="stylesheet" href="/outer.css"><div class="a" id="a"><i class="b" id="b">b</i></div>`,
      {
        'outer.css': `@import url("/inner.css");`,
        'inner.css': `.b{opacity:0}.a:hover .b{opacity:1}`,
      }
    );
    await page.waitForFunction(
      () => getComputedStyle(document.getElementById('b')!).opacity === '0'
    );
    const r = await page.evaluate(() =>
      window.FH.forcePseudoState(document.getElementById('a'), 'hover')
    );
    expect(r.rulesCloned).toBe(1);
    expect(r.sheetsScanned).toBe(2);
    expect((await read(page, '#b')).opacity).toBe('1');
    await page.evaluate(() => window.FH.releaseForcedPseudoState());
    expect((await read(page, '#b')).opacity).toBe('0');
    expect(await twinsLeft(page)).toBe(0);
    await page.close();
  }, 30_000);

  it('an adoptedStyleSheets rule', async () => {
    const page = await openPage(`<div class="a" id="a"><i class="b" id="b">b</i></div>`);
    await page.evaluate(() => {
      const s = new CSSStyleSheet();
      s.replaceSync('.b{opacity:0}.a:hover .b{opacity:1}');
      document.adoptedStyleSheets = [s];
    });
    const r = await page.evaluate(() =>
      window.FH.forcePseudoState(document.getElementById('a'), 'hover')
    );
    expect(r.rulesCloned).toBe(1);
    expect((await read(page, '#b')).opacity).toBe('1');
    await page.evaluate(() => window.FH.releaseForcedPseudoState());
    expect((await read(page, '#b')).opacity).toBe('0');
    expect(await twinsLeft(page)).toBe(0);
    await page.close();
  }, 30_000);

  it('a shadow-root rule (:host(:hover) and an inner :hover), with the chain marked across the boundary', async () => {
    const page = await openPage(`<div id="host"></div>`);
    await page.evaluate(() => {
      const root = document.getElementById('host')!.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>.x{opacity:0}.y{opacity:0}:host(:hover) .x{opacity:1}.w:hover .y{opacity:1}</style><div class="w"><span id="in">in</span><i class="x">x</i><i class="y">y</i></div>`;
    });
    const r = await page.evaluate(() =>
      window.FH.forcePseudoState(
        document.getElementById('host')!.shadowRoot!.getElementById('in'),
        'hover'
      )
    );
    expect(r.rulesCloned).toBe(2);
    const shadowOpacity = (): Promise<string[]> =>
      page.evaluate(() => {
        const root = document.getElementById('host')!.shadowRoot!;
        return ['.x', '.y'].map((s) => getComputedStyle(root.querySelector(s)!).opacity);
      });
    expect(await shadowOpacity()).toEqual(['1', '1']);
    await page.evaluate(() => window.FH.releaseForcedPseudoState());
    expect(await shadowOpacity()).toEqual(['0', '0']);
    expect(await twinsLeft(page)).toBe(0);
    await page.close();
  }, 30_000);

  it(':not(:hover) is inverted correctly', async () => {
    const page = await openPage(`<div class="c" id="c">c</div>`);
    await page.addStyleTag({ content: `.c{opacity:1}.c:not(:hover){opacity:.5}` });
    expect((await read(page, '#c')).opacity).toBe('0.5');
    await page.evaluate(() => window.FH.forcePseudoState(document.getElementById('c'), 'hover'));
    // The original `:not(:hover)` still matches (nothing is really hovered);
    // its twin `:not([attr])` does not, so the forced state is decided by the
    // original alone — exactly a real hover's reading of the original.
    const sel = await page.evaluate(
      () => (document.styleSheets[0].cssRules[2] as CSSStyleRule).selectorText
    );
    expect(sel).toBe('.c:not([data-ui-bridge-pseudo-hover])');
    // LIMIT, pinned: the twin cannot un-match the original, so a page whose
    // rest style lives in `:not(:hover)` keeps it while forced.
    expect((await read(page, '#c')).opacity).toBe('0.5');
    await page.evaluate(() => window.FH.releaseForcedPseudoState());
    await page.close();
  }, 30_000);

  it('a cross-origin sheet is counted in unreadableSheets and makes the report incomplete', async () => {
    foreignFiles.set('/x.css', { type: 'text/css', body: `.zz:hover{color:red}` });
    const page = await openPage(
      `<link rel="stylesheet" href="${foreignOrigin}/x.css"><div class="a" id="a"><i class="b" id="b">b</i></div>`
    );
    await page.waitForFunction(() => document.styleSheets.length === 1);
    const r = await page.evaluate(() =>
      window.FH.forcePseudoState(document.getElementById('a'), 'hover')
    );
    expect(r.unreadableSheets).toBe(1);
    expect(r.unreadableSheetHrefs).toEqual([`${foreignOrigin}/x.css`]);
    expect(r.complete).toBe(false);
    await page.evaluate(() => window.FH.releaseForcedPseudoState());
    await page.close();
  }, 30_000);

  it('a second apply releases the first', async () => {
    const page = await openPage(
      `<div class="a" id="a1"><i class="b" id="b1">b</i></div><div class="a" id="a2"><i class="b" id="b2">b</i></div>`
    );
    await page.addStyleTag({ content: `.b{opacity:0}.a:hover .b{opacity:1}` });
    await page.evaluate(() => window.FH.forcePseudoState(document.getElementById('a1'), 'hover'));
    expect((await read(page, '#b1')).opacity).toBe('1');
    const second = await page.evaluate(() =>
      window.FH.forcePseudoState(document.getElementById('a2'), 'hover')
    );
    expect(second.replaced).toMatchObject({ released: true, reason: 'replaced' });
    expect((await read(page, '#b1')).opacity).toBe('0');
    expect((await read(page, '#b2')).opacity).toBe('1');
    expect(await twinsLeft(page)).toBe(1);
    await page.evaluate(() => window.FH.releaseForcedPseudoState());
    expect(await twinsLeft(page)).toBe(0);
    await page.close();
  }, 30_000);

  it('the TTL releases the hold by itself', async () => {
    const page = await openPage(`<div class="a" id="a"><i class="b" id="b">b</i></div>`);
    await page.addStyleTag({ content: `.b{opacity:0}.a:hover .b{opacity:1}` });
    const r = await page.evaluate(() =>
      window.FH.forcePseudoState(document.getElementById('a'), 'hover', { holdMs: 300 })
    );
    expect(r.holdMs).toBe(300);
    expect((await read(page, '#b')).opacity).toBe('1');
    await page.waitForFunction(() => window.FH.getForcedPseudoState() === null, null, {
      timeout: 5_000,
    });
    expect((await read(page, '#b')).opacity).toBe('0');
    expect(await twinsLeft(page)).toBe(0);
    expect(await marksLeft(page)).toBe(0);
    await page.close();
  }, 30_000);

  it('a page rule changed during the hold reports restored_with_drift, naming the element', async () => {
    const page = await openPage(
      `<div class="a" id="a" data-id="a"><i class="b" id="b" data-id="b">b</i></div>`
    );
    await page.addStyleTag({ content: `.b{opacity:0}.a:hover .b{opacity:1}` });
    await page.evaluate(() =>
      window.FH.forcePseudoState(document.getElementById('a'), 'hover', {
        registry: window.FH.registryOf(),
      })
    );
    await page.addStyleTag({ content: `.b{opacity:.5}` });
    const rel = await page.evaluate(() => window.FH.releaseForcedPseudoState());
    expect(rel.restore).toBe('restored_with_drift');
    expect(rel.drift).toEqual([{ id: 'b', property: 'opacity', before: '0', after: '0.5' }]);
    await page.close();
  }, 30_000);

  it('settle waits out a delayed transition (transition-opacity duration-200 delay-150)', async () => {
    const page = await openPage(
      `<div class="group" id="g"><span id="h">h</span><i id="t" data-id="t" class="opacity-0 group-hover:opacity-100 transition-opacity duration-200 delay-150">t</i></div>`
    );
    await page.addStyleTag({ content: TAILWIND_V4_BUILD_CSS });
    // Adding the sheet after first paint starts a 1 -> 0 fade on the rest
    // state; let it finish so the apply starts from rest.
    await page.waitForFunction(() => document.getAnimations().length === 0);
    const r = await page.evaluate(() =>
      window.FH.forcePseudoState(document.getElementById('h'), 'hover', {
        registry: window.FH.registryOf(),
      })
    );
    expect(r.settled).toBe(true);
    expect(r.settleMs).toBeGreaterThanOrEqual(300);
    expect(r.revealed).toEqual([
      expect.objectContaining({
        id: 't',
        changes: [{ property: 'opacity', before: '0', after: '1' }],
      }),
    ]);
    const rel = await page.evaluate(() => window.FH.releaseForcedPseudoState());
    expect(rel).toMatchObject({ settled: true, restore: 'verified' });
    await page.close();
  }, 30_000);

  it('executeAction("hover") end to end: the registry flips the revealed control visible, and a write-class click releases it', async () => {
    const page = await openPage(GROUP_HTML);
    await page.addStyleTag({ content: TAILWIND_V4_DEV_CSS });
    const out = await page.evaluate(async () => {
      const registry = new window.FH.UIBridgeRegistry();
      registry.registerElement('header', document.getElementById('header'), { type: 'generic' });
      registry.registerElement('tool', document.getElementById('tool'), { type: 'button' });
      const executor = new window.FH.DefaultActionExecutor(registry);
      const visible = (): boolean => registry.getElement('tool').getState().visible;
      const beforeVisible = visible();
      const refused = await executor.executeAction('tool', { action: 'click' });
      const hover = await executor.executeAction('header', { action: 'hover' });
      const hoveredVisible = visible();
      let clicked = 0;
      document.getElementById('tool')!.addEventListener('click', () => (clicked += 1));
      const click = await executor.executeAction('tool', { action: 'click' });
      return {
        beforeVisible,
        refusedSuccess: refused.success,
        hoverSuccess: hover.success,
        revealed: hover.forcedHover?.applied?.revealed?.map((r: { id: string }) => r.id),
        hoveredVisible,
        clickSuccess: click.success,
        clicked,
        clickRelease: click.forcedHover?.released,
        afterVisible: visible(),
        held: window.FH.getForcedPseudoState(),
      };
    });
    expect(out.beforeVisible).toBe(false);
    expect(out.refusedSuccess).toBe(false);
    expect(out.hoverSuccess).toBe(true);
    expect(out.revealed).toContain('tool');
    expect(out.hoveredVisible).toBe(true);
    expect(out.clickSuccess).toBe(true);
    expect(out.clicked).toBe(1);
    expect(out.clickRelease).toMatchObject({
      released: true,
      reason: 'next-action',
      restore: 'verified',
    });
    expect(out.afterVisible).toBe(false);
    expect(out.held).toBeNull();
    await page.close();
  }, 30_000);
});
