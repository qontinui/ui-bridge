// @vitest-environment node
/**
 * Real-Chromium measurement of `:focus-visible` under the design inspector's
 * focus (plan
 * 2026-11-19-the-ui-bridge-design-surface-is-blocked-behind-a-stalled-pr-unpublished-packages-and-a-score,
 * Phase 2).
 *
 * The inspector's `focus` state is a programmatic `el.focus()`. Whether
 * `:focus-visible` then matches is the browser's input-modality heuristic, so
 * the appearance the `focus` entry reports depends on what input preceded the
 * read. jsdom has no such heuristic, so this is measured in a real Chromium and
 * every reading is ASSERTED: a Chromium change to the heuristic turns this red
 * rather than silently changing what the inspector reports.
 *
 * Measured (Playwright Chromium, 2026-11-21):
 *   no prior input                        -> matches  (keyboard appearance)
 *   pointer click on a non-focusable area -> matches  (keyboard appearance)
 *   pointer click on a focusable element  -> NO match (pointer appearance)
 *   keyboard Tab                          -> matches  (keyboard appearance)
 * The third is a condition the inspector is routinely in (a user clicked a
 * button, then an agent inspects), which is why `focus-visible` is a forced
 * state of its own and the `focus` entry reports the match it saw.
 *
 * The modules under test are bundled from source with esbuild and injected
 * into each page, as in `control/forced-hover.smoke.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright';
import { chromiumAvailable } from '../../../../test-support/chromium-gate.mjs';

const PLAYWRIGHT_AVAILABLE = chromiumAvailable();

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');

const files = new Map<string, string>();
let server: Server;
let origin: string;
let browser: Browser;
let bundle: string;
let pageSeq = 0;

/**
 * `:focus` and `:focus-visible` draw distinct outlines (same specificity, so
 * the later `:focus-visible` rule wins when it matches), and the common
 * `:focus:not(:focus-visible)` idiom draws a ring only in the pointer
 * appearance — the rewrite must turn that one OFF while forced.
 */
const FIXTURE_CSS = `
  #t:focus { outline: 3px solid rgb(0, 0, 255); }
  #t:focus-visible { outline: 5px dashed rgb(255, 0, 0); }
  #t:focus:not(:focus-visible) { box-shadow: rgb(0, 0, 255) 0px 0px 0px 2px; }
  #wrap:focus-visible { background-color: rgb(0, 128, 0); }
`;

const FIXTURE_HTML = `
  <div id="pad" style="width: 300px; height: 60px">not focusable</div>
  <input id="first" aria-label="first">
  <div id="wrap" tabindex="-1"><button id="t">target</button></div>
  <button id="other">other</button>`;

async function openPage(): Promise<Page> {
  pageSeq += 1;
  const name = `/p${pageSeq}`;
  files.set(
    name,
    `<!doctype html><html><head><meta charset="utf-8"><style>${FIXTURE_CSS}</style></head><body>${FIXTURE_HTML}</body></html>`
  );
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(`${origin}${name}`);
  await page.addScriptTag({ content: bundle });
  return page;
}

type Condition =
  | 'no prior input'
  | 'pointer click on a non-focusable area'
  | 'pointer click on a focusable element'
  | 'keyboard Tab';

/** Put the page's input modality into `condition` without focusing the target. */
async function prime(page: Page, condition: Condition): Promise<void> {
  switch (condition) {
    case 'no prior input':
      return;
    case 'pointer click on a non-focusable area':
      await page.mouse.click(50, 20);
      return;
    case 'pointer click on a focusable element':
      await page.click('#other');
      return;
    case 'keyboard Tab':
      // Tab lands on `#first`, so the read below is still a programmatic
      // focus of `#t`, made after keyboard input.
      await page.keyboard.press('Tab');
      if ((await page.evaluate(() => document.activeElement?.id)) !== 'first') {
        throw new Error('fixture: Tab did not land on #first');
      }
      return;
  }
}

interface FocusReading {
  focused: boolean;
  focusVisible: boolean;
  outline: string;
}

const focusAndRead = (page: Page): Promise<FocusReading> =>
  page.evaluate(() => {
    const el = document.getElementById('t')!;
    el.focus();
    const cs = getComputedStyle(el);
    return {
      focused: document.activeElement === el,
      focusVisible: el.matches(':focus-visible'),
      outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
    };
  });

const KEYBOARD_OUTLINE = 'dashed 5px rgb(255, 0, 0)';
const POINTER_OUTLINE = 'solid 3px rgb(0, 0, 255)';

const rewritesLeft = (page: Page): Promise<number> =>
  page.evaluate(() => {
    let n = 0;
    for (const sheet of Array.from(document.styleSheets)) {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule.cssText.includes('data-ui-bridge-pseudo-')) n += 1;
      }
    }
    return n;
  });

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    FV: any;
  }
}

beforeAll(async () => {
  if (!PLAYWRIGHT_AVAILABLE) return;
  const out = await build({
    stdin: {
      contents: `
        export { captureStateVariations, readFocusVisible } from './ai/design-inspector';
        export { forcePseudoState, releaseForcedPseudoState } from './control/forced-hover';
      `,
      resolveDir: SRC,
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    globalName: 'FV',
    platform: 'browser',
    target: 'chrome120',
    write: false,
    logLevel: 'silent',
    define: { __SDK_VERSION__: '"smoke"', 'process.env.NODE_ENV': '"test"' },
  });
  bundle = out.outputFiles[0].text;
  server = createServer((req, res) => {
    const body = files.get((req.url ?? '/').split('?')[0]);
    if (!body) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
}, 120_000);

describe.skipIf(!PLAYWRIGHT_AVAILABLE)(
  ':focus-visible under a programmatic focus (real Chromium)',
  () => {
    const MEASURED: Array<[Condition, boolean]> = [
      ['no prior input', true],
      ['pointer click on a non-focusable area', true],
      ['pointer click on a focusable element', false],
      ['keyboard Tab', true],
    ];

    for (const [condition, expected] of MEASURED) {
      it(`after ${condition}: el.focus() ${expected ? 'matches' : 'does NOT match'} :focus-visible`, async () => {
        const page = await openPage();
        await prime(page, condition);
        const reading = await focusAndRead(page);
        expect(reading).toEqual({
          focused: true,
          focusVisible: expected,
          outline: expected ? KEYBOARD_OUTLINE : POINTER_OUTLINE,
        });
        await page.close();
      }, 30_000);
    }
  }
);

describe.skipIf(!PLAYWRIGHT_AVAILABLE)('design inspector focus states (real Chromium)', () => {
  const readStates = (page: Page) =>
    page.evaluate(async () => {
      const el = document.getElementById('t')!;
      const states = await window.FV.captureStateVariations(el, ['focus', 'focus-visible']);
      return states.map(
        (s: {
          state: string;
          focusVisible?: unknown;
          focused?: unknown;
          styles: Record<string, string>;
        }) => ({
          state: s.state,
          focusVisible: s.focusVisible,
          focused: s.focused,
          outline: s.styles.outline,
          boxShadow: s.styles.boxShadow,
        })
      );
    });

  it('after a pointer focus: the focus entry reports focusVisible=false and the focus-visible entry forces the keyboard appearance', async () => {
    const page = await openPage();
    await prime(page, 'pointer click on a focusable element');
    const states = await readStates(page);

    const byState = Object.fromEntries(states.map((s: { state: string }) => [s.state, s]));
    expect(Object.keys(byState)).toEqual(['default', 'focus', 'focus-visible']);
    expect(byState.default.focusVisible).toBeUndefined();
    expect(byState.focus.focusVisible).toBe(false);
    expect(byState.focus.outline).toBe('rgb(0, 0, 255) solid 3px');
    expect(byState.focus.boxShadow).toBe('rgb(0, 0, 255) 0px 0px 0px 2px');
    // Forced: the `:focus-visible` rule applies and the `:not(:focus-visible)` one stops.
    expect(byState['focus-visible'].focusVisible).toBeUndefined();
    expect(byState['focus-visible'].focused).toBe(true);
    expect(byState.focus.focused).toBeUndefined();
    expect(byState['focus-visible'].outline).toBe('rgb(255, 0, 0) dashed 5px');
    expect(byState['focus-visible'].boxShadow).toBe('none');

    // Restored: no rewritten selector, no mark, focus back on `#other`.
    expect(await rewritesLeft(page)).toBe(0);
    const after = await page.evaluate(() => ({
      marks: document.querySelectorAll('[data-ui-bridge-pseudo-focus-visible]').length,
      active: document.activeElement?.id,
    }));
    expect(after).toEqual({ marks: 0, active: 'other' });
    await page.close();
  }, 30_000);

  it('with no prior input: the focus entry reports focusVisible=true and already draws the keyboard appearance', async () => {
    const page = await openPage();
    const states = await readStates(page);
    const focus = states.find((s: { state: string }) => s.state === 'focus');
    expect(focus.focusVisible).toBe(true);
    expect(focus.outline).toBe('rgb(255, 0, 0) dashed 5px');
    expect(focus.boxShadow).toBe('none');
    await page.close();
  }, 30_000);

  it('forcing focus-visible marks the target only: an ancestor :focus-visible rule does not apply', async () => {
    const page = await openPage();
    await prime(page, 'pointer click on a focusable element');
    const read = await page.evaluate(async () => {
      const el = document.getElementById('t')!;
      el.focus();
      const report = await window.FV.forcePseudoState(el, 'focus-visible');
      const wrapBg = getComputedStyle(document.getElementById('wrap')!).backgroundColor;
      const outline = getComputedStyle(el).outlineStyle;
      const release = await window.FV.releaseForcedPseudoState('explicit');
      return {
        rulesRewritten: report.rulesRewritten,
        markedElements: report.markedElements,
        wrapBg,
        outline,
        restore: release.restore,
        outlineAfter: getComputedStyle(el).outlineStyle,
      };
    });
    // `#t:focus-visible`, `#t:focus:not(:focus-visible)`, `#wrap:focus-visible`
    expect(read).toEqual({
      rulesRewritten: 3,
      markedElements: 1,
      wrapBg: 'rgba(0, 0, 0, 0)',
      outline: 'dashed',
      restore: 'verified',
      outlineAfter: 'solid',
    });
    expect(await rewritesLeft(page)).toBe(0);
    await page.close();
  }, 30_000);

  it("a non-focusable element: focus reports 'not_focused', focus-visible reports focused=false and forces nothing", async () => {
    const page = await openPage();
    await prime(page, 'pointer click on a focusable element');
    const read = await page.evaluate(async () => {
      const pad = document.getElementById('pad')!;
      const written: Array<string | null> = [];
      const observer = new MutationObserver((records) => {
        for (const r of records) written.push(r.attributeName);
      });
      observer.observe(pad, { attributes: true });
      const states = await window.FV.captureStateVariations(pad, ['focus', 'focus-visible']);
      for (const r of observer.takeRecords()) written.push(r.attributeName);
      observer.disconnect();
      const by = Object.fromEntries(
        states.map((s: { state: string; focusVisible?: unknown; focused?: unknown }) => [
          s.state,
          { focusVisible: s.focusVisible, focused: s.focused },
        ])
      );
      return {
        focus: by.focus,
        focusVisible: by['focus-visible'],
        direct: window.FV.readFocusVisible(pad),
        marked: written.includes('data-ui-bridge-pseudo-focus-visible'),
        active: document.activeElement?.id,
      };
    });
    expect(read).toEqual({
      focus: { focusVisible: 'not_focused', focused: undefined },
      focusVisible: { focusVisible: undefined, focused: false },
      direct: 'not_focused',
      marked: false,
      active: 'other',
    });
    expect(await rewritesLeft(page)).toBe(0);
    await page.close();
  }, 30_000);

  it("a focus whose :focus-visible match cannot be read is 'unknown', never false", async () => {
    const page = await openPage();
    const read = await page.evaluate(async () => {
      const native = Element.prototype.matches;
      Element.prototype.matches = function (this: Element, selector: string): boolean {
        if (selector.includes(':focus-visible')) {
          throw new DOMException(`'${selector}' is not a valid selector.`, 'SyntaxError');
        }
        return native.call(this, selector);
      };
      try {
        const el = document.getElementById('t')!;
        const states = await window.FV.captureStateVariations(el, ['focus']);
        el.focus();
        const direct = window.FV.readFocusVisible(el);
        el.blur();
        return {
          direct,
          entry: states.find((s: { state: string }) => s.state === 'focus').focusVisible,
        };
      } finally {
        Element.prototype.matches = native;
      }
    });
    expect(read).toEqual({ direct: 'unknown', entry: 'unknown' });
    await page.close();
  }, 30_000);
});
