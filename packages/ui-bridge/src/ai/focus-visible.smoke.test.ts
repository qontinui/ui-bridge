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
          forced?: unknown;
          focused?: unknown;
          styles: Record<string, string>;
        }) => ({
          state: s.state,
          focusVisible: s.focusVisible,
          forced: s.forced,
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
    expect(byState['focus-visible'].forced).toBe(true);
    expect(byState['focus-visible'].focused).toBe(true);
    expect(byState.focus.forced).toBeUndefined();
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
        states.map(
          (s: { state: string; focusVisible?: unknown; forced?: unknown; focused?: unknown }) => [
            s.state,
            { focusVisible: s.focusVisible, forced: s.forced, focused: s.focused },
          ]
        )
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
      focus: { focusVisible: 'not_focused', forced: undefined, focused: undefined },
      focusVisible: { focusVisible: undefined, forced: false, focused: false },
      direct: 'not_focused',
      marked: false,
      active: 'other',
    });
    expect(await rewritesLeft(page)).toBe(0);
    await page.close();
  }, 30_000);

  it('an element inside an open shadow root holds focus, and focus returns to the previous element after', async () => {
    const page = await openPage();
    await prime(page, 'pointer click on a focusable element');
    const read = await page.evaluate(async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `<style>button:focus-visible { outline: 5px dashed rgb(255, 0, 0); }</style><button id="sb">inner</button>`;
      const inner = shadow.getElementById('sb')!;
      const states = await window.FV.captureStateVariations(inner, ['focus', 'focus-visible']);
      const by = Object.fromEntries(
        states.map(
          (s: {
            state: string;
            focusVisible?: unknown;
            forced?: unknown;
            focused?: unknown;
            styles: Record<string, string>;
          }) => [
            s.state,
            {
              focusVisible: s.focusVisible,
              forced: s.forced,
              focused: s.focused,
              outline: s.styles.outline,
            },
          ]
        )
      );
      return {
        focusVisible: by.focus.focusVisible,
        forced: by['focus-visible'].forced,
        focused: by['focus-visible'].focused,
        forcedOutline: by['focus-visible'].outline,
        active: document.activeElement?.id,
        shadowActive: shadow.activeElement,
      };
    });
    expect(read).toEqual({
      // Chromium's heuristic after a pointer focus (see the table above).
      focusVisible: false,
      forced: true,
      focused: true,
      forcedOutline: 'rgb(255, 0, 0) dashed 5px',
      active: 'other',
      shadowActive: null,
    });
    await page.close();
  }, 30_000);

  it('a non-focusable shadow host whose inner input has focus does not hold focus, and the input keeps it', async () => {
    const page = await openPage();
    const read = await page.evaluate(async () => {
      const host = document.createElement('div');
      host.id = 'host';
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `<input id="si" aria-label="inner">`;
      const input = shadow.getElementById('si') as HTMLInputElement;
      input.focus();
      const written: Array<string | null> = [];
      const observer = new MutationObserver((records) => {
        for (const r of records) written.push(r.attributeName);
      });
      observer.observe(host, { attributes: true });
      const retargeted = document.activeElement?.id;
      const states = await window.FV.captureStateVariations(host, ['focus', 'focus-visible']);
      for (const r of observer.takeRecords()) written.push(r.attributeName);
      observer.disconnect();
      const by = Object.fromEntries(
        states.map(
          (s: { state: string; focusVisible?: unknown; forced?: unknown; focused?: unknown }) => [
            s.state,
            { focusVisible: s.focusVisible, forced: s.forced, focused: s.focused },
          ]
        )
      );
      return {
        retargeted,
        focusVisible: by.focus.focusVisible,
        forced: by['focus-visible'].forced,
        focused: by['focus-visible'].focused,
        marked: written.includes('data-ui-bridge-pseudo-focus-visible'),
        innerStillFocused: shadow.activeElement === input,
      };
    });
    expect(read).toEqual({
      retargeted: 'host',
      focusVisible: 'not_focused',
      forced: false,
      focused: false,
      marked: false,
      innerStillFocused: true,
    });
    await page.close();
  }, 30_000);

  it('an element in a same-origin iframe holds focus, and focus returns to its previous element there', async () => {
    const page = await openPage();
    const read = await page.evaluate(async () => {
      const frame = document.createElement('iframe');
      frame.srcdoc = `<!doctype html><style>#ib:focus-visible { outline: 5px dashed rgb(255, 0, 0); }</style><button id="ib">in frame</button><input id="iprev" aria-label="prev">`;
      const loaded = new Promise((done) => frame.addEventListener('load', done, { once: true }));
      document.body.appendChild(frame);
      await loaded;
      const doc = frame.contentDocument!;
      (doc.getElementById('iprev') as HTMLInputElement).focus();
      const target = doc.getElementById('ib')!;
      const states = await window.FV.captureStateVariations(target, ['focus', 'focus-visible']);
      const by = Object.fromEntries(
        states.map(
          (s: {
            state: string;
            focusVisible?: unknown;
            forced?: unknown;
            focused?: unknown;
            styles: Record<string, string>;
          }) => [
            s.state,
            {
              focusVisible: s.focusVisible,
              forced: s.forced,
              focused: s.focused,
              outline: s.styles.outline,
            },
          ]
        )
      );
      return {
        focusVisible: by.focus.focusVisible,
        forced: by['focus-visible'].forced,
        focused: by['focus-visible'].focused,
        forcedOutline: by['focus-visible'].outline,
        frameActive: doc.activeElement?.id,
      };
    });
    expect(read).toEqual({
      // No pointer input reached the frame: Chromium's heuristic matches.
      focusVisible: true,
      forced: true,
      focused: true,
      forcedOutline: 'rgb(255, 0, 0) dashed 5px',
      frameActive: 'iprev',
    });
    await page.close();
  }, 30_000);

  it('an element inside a CLOSED shadow root holds focus, and focus returns to the previous element after', async () => {
    const page = await openPage();
    await prime(page, 'pointer click on a focusable element');
    const read = await page.evaluate(async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const closed = host.attachShadow({ mode: 'closed' });
      closed.innerHTML = `<style>button:focus-visible { outline: 5px dashed rgb(255, 0, 0); }</style><button id="cb">inner</button>`;
      const inner = closed.getElementById('cb')!;
      const states = await window.FV.captureStateVariations(inner, ['focus', 'focus-visible']);
      const by = Object.fromEntries(
        states.map(
          (s: {
            state: string;
            focusVisible?: unknown;
            forced?: unknown;
            focused?: unknown;
            styles: Record<string, string>;
          }) => [
            s.state,
            {
              focusVisible: s.focusVisible,
              forced: s.forced,
              focused: s.focused,
              outline: s.styles.outline,
            },
          ]
        )
      );
      return {
        hostShadowRoot: host.shadowRoot,
        focusVisible: by.focus.focusVisible,
        forced: by['focus-visible'].forced,
        focused: by['focus-visible'].focused,
        forcedOutline: by['focus-visible'].outline,
        active: document.activeElement?.id,
        closedActive: closed.activeElement,
      };
    });
    expect(read).toEqual({
      hostShadowRoot: null,
      focusVisible: false,
      forced: true,
      focused: true,
      forcedOutline: 'rgb(255, 0, 0) dashed 5px',
      active: 'other',
      closedActive: null,
    });
    await page.close();
  }, 30_000);

  it('a delegatesFocus host: el.focus() delegates inside, the host holds focus and its ring is forced', async () => {
    const page = await openPage();
    await prime(page, 'pointer click on a focusable element');
    const read = await page.evaluate(async () => {
      const host = document.createElement('div');
      host.id = 'dhost';
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open', delegatesFocus: true });
      shadow.innerHTML = `<button id="db">inner</button>`;
      const style = document.createElement('style');
      style.textContent = `#dhost:focus-visible { outline: 5px dashed rgb(255, 0, 0); }`;
      document.head.appendChild(style);
      const states = await window.FV.captureStateVariations(host, ['focus', 'focus-visible']);
      const by = Object.fromEntries(
        states.map(
          (s: {
            state: string;
            focusVisible?: unknown;
            forced?: unknown;
            focused?: unknown;
            styles: Record<string, string>;
          }) => [
            s.state,
            {
              focusVisible: s.focusVisible,
              forced: s.forced,
              focused: s.focused,
              outline: s.styles.outline,
            },
          ]
        )
      );
      return {
        focusVisible: by.focus.focusVisible,
        forced: by['focus-visible'].forced,
        focused: by['focus-visible'].focused,
        forcedOutline: by['focus-visible'].outline,
        active: document.activeElement?.id,
        shadowActive: shadow.activeElement,
      };
    });
    expect(read).toEqual({
      // After a pointer focus, as for a light-DOM element.
      focusVisible: false,
      forced: true,
      focused: true,
      forcedOutline: 'rgb(255, 0, 0) dashed 5px',
      active: 'other',
      shadowActive: null,
    });
    await page.close();
  }, 30_000);

  it('a previous focus inside a delegatesFocus host is kept by the restore', async () => {
    const page = await openPage();
    const read = await page.evaluate(async () => {
      const host = document.createElement('div');
      host.id = 'dhost2';
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open', delegatesFocus: true });
      shadow.innerHTML = `<button id="first-in">first</button><input id="second-in" aria-label="second">`;
      const second = shadow.getElementById('second-in') as HTMLInputElement;
      second.focus();
      const states = await window.FV.captureStateVariations(host, ['focus', 'focus-visible']);
      const by = Object.fromEntries(
        states.map((s: { state: string; forced?: unknown; focused?: unknown }) => [
          s.state,
          { forced: s.forced, focused: s.focused },
        ])
      );
      return {
        forced: by['focus-visible'].forced,
        focused: by['focus-visible'].focused,
        active: document.activeElement?.id,
        shadowActive: shadow.activeElement?.id,
      };
    });
    expect(read).toEqual({
      forced: true,
      focused: true,
      active: 'dhost2',
      shadowActive: 'second-in',
    });
    expect(await rewritesLeft(page)).toBe(0);
    await page.close();
  }, 30_000);

  it('an element already focused before the read is still focused after it', async () => {
    const page = await openPage();
    await prime(page, 'pointer click on a focusable element');
    const read = await page.evaluate(async () => {
      const el = document.getElementById('t')!;
      el.focus();
      const states = await window.FV.captureStateVariations(el, ['focus', 'focus-visible']);
      const fv = states.find((s: { state: string }) => s.state === 'focus-visible');
      return { forced: fv.forced, focused: fv.focused, active: document.activeElement?.id };
    });
    expect(read).toEqual({ forced: true, focused: true, active: 't' });
    expect(await rewritesLeft(page)).toBe(0);
    await page.close();
  }, 30_000);

  it('inside one CLOSED shadow root, the previous focus in that root comes back and the inspected element is left unfocused', async () => {
    const page = await openPage();
    const read = await page.evaluate(async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const closed = host.attachShadow({ mode: 'closed' });
      closed.innerHTML = `<input id="cb-prev" aria-label="prev"><button id="cb-target">target</button>`;
      const previous = closed.getElementById('cb-prev') as HTMLInputElement;
      const target = closed.getElementById('cb-target')!;
      previous.focus();
      const states = await window.FV.captureStateVariations(target, ['focus', 'focus-visible']);
      const fv = states.find((s: { state: string }) => s.state === 'focus-visible');
      return {
        forced: fv.forced,
        focused: fv.focused,
        closedActive: (closed.activeElement as Element | null)?.id ?? null,
        targetFocused: window.FV.readFocusVisible(target),
      };
    });
    expect(read).toEqual({
      forced: true,
      focused: true,
      closedActive: 'cb-prev',
      targetFocused: 'not_focused',
    });
    expect(await rewritesLeft(page)).toBe(0);
    await page.close();
  }, 30_000);

  it('a focus in a CLOSED tree enclosing the element, outside its own root, comes back and the element is left unfocused', async () => {
    const page = await openPage();
    const read = await page.evaluate(async () => {
      // C (closed) holds input X and host H; H's closed root holds the target.
      const outerHost = document.createElement('div');
      outerHost.id = 'outer-host';
      document.body.appendChild(outerHost);
      const outer = outerHost.attachShadow({ mode: 'closed' });
      outer.innerHTML = `<input id="nx" aria-label="x"><div id="inner-host"></div>`;
      const x = outer.getElementById('nx') as HTMLInputElement;
      const inner = outer.getElementById('inner-host')!.attachShadow({ mode: 'closed' });
      inner.innerHTML = `<button id="nt">target</button>`;
      const target = inner.getElementById('nt')!;
      x.focus();
      const retargeted = document.activeElement?.id;
      const states = await window.FV.captureStateVariations(target, ['focus', 'focus-visible']);
      const fv = states.find((s: { state: string }) => s.state === 'focus-visible');
      return {
        retargeted,
        forced: fv.forced,
        focused: fv.focused,
        outerActive: (outer.activeElement as Element | null)?.id ?? null,
        innerActive: inner.activeElement,
        target: window.FV.readFocusVisible(target),
      };
    });
    expect(read).toEqual({
      retargeted: 'outer-host',
      forced: true,
      focused: true,
      outerActive: 'nx',
      innerActive: null,
      target: 'not_focused',
    });
    expect(await rewritesLeft(page)).toBe(0);
    await page.close();
  }, 30_000);

  it("inspecting inside a frame while a parent input holds the focus: the parent's input is focused again after", async () => {
    const page = await openPage();
    const read = await page.evaluate(async () => {
      const outside = document.createElement('input');
      outside.id = 'outside';
      outside.setAttribute('aria-label', 'outside');
      document.body.appendChild(outside);
      const frame = document.createElement('iframe');
      frame.srcdoc = `<!doctype html><style>#fb:focus-visible { outline: 5px dashed rgb(255, 0, 0); }</style><button id="fb">in frame</button>`;
      const loaded = new Promise((done) => frame.addEventListener('load', done, { once: true }));
      document.body.appendChild(frame);
      await loaded;
      outside.focus();
      const doc = frame.contentDocument!;
      const target = doc.getElementById('fb')!;
      const states = await window.FV.captureStateVariations(target, ['focus', 'focus-visible']);
      const fv = states.find((s: { state: string }) => s.state === 'focus-visible');
      return {
        forced: fv.forced,
        forcedOutline: fv.styles.outline,
        active: document.activeElement?.id,
        frameActive: doc.activeElement === doc.body ? 'body' : doc.activeElement?.id,
        target: window.FV.readFocusVisible(target),
      };
    });
    expect(read).toEqual({
      forced: true,
      forcedOutline: 'rgb(255, 0, 0) dashed 5px',
      active: 'outside',
      frameActive: 'body',
      target: 'not_focused',
    });
    await page.close();
  }, 30_000);

  it('inspecting inside a frame when nothing had focus: the frame is blurred out of the parent again', async () => {
    const page = await openPage();
    const read = await page.evaluate(async () => {
      const frame = document.createElement('iframe');
      frame.srcdoc = `<!doctype html><button id="fb2">in frame</button>`;
      const loaded = new Promise((done) => frame.addEventListener('load', done, { once: true }));
      document.body.appendChild(frame);
      await loaded;
      const before = document.activeElement === document.body;
      const doc = frame.contentDocument!;
      const target = doc.getElementById('fb2')!;
      await window.FV.captureStateVariations(target, ['focus', 'focus-visible']);
      return {
        before,
        after: document.activeElement === document.body ? 'body' : document.activeElement?.tagName,
        target: window.FV.readFocusVisible(target),
      };
    });
    expect(read).toEqual({ before: true, after: 'body', target: 'not_focused' });
    await page.close();
  }, 30_000);

  it('a frame inside a CLOSED shadow root, nothing focused: the frame is blurred out of the page again', async () => {
    const page = await openPage();
    const read = await page.evaluate(async () => {
      const host = document.createElement('div');
      host.id = 'closed-frame-host';
      document.body.appendChild(host);
      const closed = host.attachShadow({ mode: 'closed' });
      const frame = document.createElement('iframe');
      frame.srcdoc = `<!doctype html><button id="cf">in frame</button>`;
      const loaded = new Promise((done) => frame.addEventListener('load', done, { once: true }));
      closed.appendChild(frame);
      await loaded;
      const before = document.activeElement === document.body;
      const target = frame.contentDocument!.getElementById('cf')!;
      await window.FV.captureStateVariations(target, ['focus', 'focus-visible']);
      return {
        before,
        after: document.activeElement === document.body ? 'body' : document.activeElement?.id,
        closedActive: closed.activeElement,
      };
    });
    expect(read).toEqual({ before: true, after: 'body', closedActive: null });
    await page.close();
  }, 30_000);

  it('nested frames: a read two frames down gives the page focus back to the top input', async () => {
    // Chromium clears a frame's activeElement to its body as soon as the page
    // focus leaves the frame (measured: #y is gone once #outside is focused),
    // so no ancestor ever records a remembered focus while the top holds the
    // focus elsewhere. The restore ORDER is therefore not observable here;
    // this case pins the two-level chain: every frame back to its body and
    // the page focus back on the top input.
    const page = await openPage();
    const read = await page.evaluate(async () => {
      const outside = document.createElement('input');
      outside.id = 'outside';
      outside.setAttribute('aria-label', 'outside');
      document.body.appendChild(outside);
      // top document -> frame f1 (input #y, frame f2) -> frame f2 (button #t)
      const f1 = document.createElement('iframe');
      f1.srcdoc =
        '<!doctype html><input id="y" aria-label="y">' +
        '<iframe id="f2" srcdoc="<!doctype html><button id=&quot;t&quot;>t</button>"></iframe>';
      const loaded = new Promise((done) => f1.addEventListener('load', done, { once: true }));
      document.body.appendChild(f1);
      await loaded;
      const d1 = f1.contentDocument!;
      const f2 = d1.getElementById('f2') as HTMLIFrameElement;
      if (!f2.contentDocument?.getElementById('t')) {
        await new Promise((done) => f2.addEventListener('load', done, { once: true }));
      }
      const d2 = f2.contentDocument!;
      // Focus #y in f1, then move the page focus to the top input.
      (d1.getElementById('y') as HTMLInputElement).focus();
      outside.focus();
      const before = {
        top: document.activeElement?.id,
        f1: d1.activeElement === d1.body ? 'body' : d1.activeElement?.id,
      };
      await window.FV.captureStateVariations(d2.getElementById('t')!, ['focus', 'focus-visible']);
      return {
        before,
        top: document.activeElement?.id,
        f1: d1.activeElement === d1.body ? 'body' : d1.activeElement?.id,
        f2: d2.activeElement === d2.body ? 'body' : d2.activeElement?.id,
      };
    });
    expect(read).toEqual({
      before: { top: 'outside', f1: 'body' },
      top: 'outside',
      f1: 'body',
      f2: 'body',
    });
    await page.close();
  }, 30_000);

  it('a frame inside a focusable CLOSED host, already holding the focus: the focus stays in the frame', async () => {
    const page = await openPage();
    const read = await page.evaluate(async () => {
      const host = document.createElement('div');
      host.id = 'closed-focusable-host';
      host.tabIndex = -1;
      document.body.appendChild(host);
      const closed = host.attachShadow({ mode: 'closed' });
      const frame = document.createElement('iframe');
      frame.srcdoc = `<!doctype html><input id="fi" aria-label="fi"><button id="fb3">in frame</button>`;
      const loaded = new Promise((done) => frame.addEventListener('load', done, { once: true }));
      closed.appendChild(frame);
      await loaded;
      const doc = frame.contentDocument!;
      (doc.getElementById('fi') as HTMLInputElement).focus();
      await window.FV.captureStateVariations(doc.getElementById('fb3')!, [
        'focus',
        'focus-visible',
      ]);
      return {
        top: document.activeElement?.id,
        closedActive: closed.activeElement === frame ? 'frame' : closed.activeElement,
        frameActive: doc.activeElement?.id,
      };
    });
    // Recorded as "the frame is active" (walking up from the frame), so the
    // ancestor restore leaves it: the host is NOT refocused, which would pull
    // the focus out of the frame.
    expect(read).toEqual({
      top: 'closed-focusable-host',
      closedActive: 'frame',
      frameActive: 'fi',
    });
    await page.close();
  }, 30_000);

  it('the ancestor restore does not scroll the page back to the restored element', async () => {
    const page = await openPage();
    const read = await page.evaluate(async () => {
      const outside = document.createElement('input');
      outside.id = 'scroll-outside';
      outside.setAttribute('aria-label', 'outside');
      document.body.prepend(outside);
      const spacer = document.createElement('div');
      spacer.style.height = '3000px';
      document.body.appendChild(spacer);
      const frame = document.createElement('iframe');
      frame.srcdoc = `<!doctype html><button id="fb4">in frame</button>`;
      const loaded = new Promise((done) => frame.addEventListener('load', done, { once: true }));
      document.body.appendChild(frame);
      await loaded;
      outside.focus({ preventScroll: true });
      frame.scrollIntoView();
      const scrolledTo = window.scrollY;
      await window.FV.captureStateVariations(frame.contentDocument!.getElementById('fb4')!, [
        'focus',
      ]);
      return {
        scrolled: scrolledTo > 1000,
        scrollKept: window.scrollY === scrolledTo,
        active: document.activeElement?.id,
      };
    });
    expect(read).toEqual({ scrolled: true, scrollKept: true, active: 'scroll-outside' });
    await page.close();
  }, 30_000);

  it('an ancestor focus inside a NON-focusable closed host beside the frame: the frame does not keep the page focus', async () => {
    const page = await openPage();
    const read = await page.evaluate(async () => {
      const host = document.createElement('div');
      host.id = 'closed-input-host';
      document.body.appendChild(host);
      const closed = host.attachShadow({ mode: 'closed' });
      closed.innerHTML = `<input id="ci" aria-label="ci">`;
      const frame = document.createElement('iframe');
      frame.id = 'side-frame';
      frame.srcdoc = `<!doctype html><button id="fb5">in frame</button>`;
      const loaded = new Promise((done) => frame.addEventListener('load', done, { once: true }));
      document.body.appendChild(frame);
      await loaded;
      (closed.getElementById('ci') as HTMLInputElement).focus();
      const before = document.activeElement?.id;
      await window.FV.captureStateVariations(frame.contentDocument!.getElementById('fb5')!, [
        'focus',
        'focus-visible',
      ]);
      return {
        before,
        frameActive: document.activeElement === frame,
        after: document.activeElement === document.body ? 'body' : document.activeElement?.id,
      };
    });
    // The input's focus inside the closed host cannot be read or restored
    // (host.focus() does nothing on a non-focusable host), but the page focus
    // must not stay in the frame.
    expect(read).toEqual({ before: 'closed-input-host', frameActive: false, after: 'body' });
    await page.close();
  }, 30_000);

  it('an ancestor focus inside a CLOSED delegatesFocus host that encloses the frame: the input that had the focus gets it back', async () => {
    const page = await openPage();
    const read = await page.evaluate(async () => {
      const host = document.createElement('div');
      host.id = 'closed-delegating-host';
      document.body.appendChild(host);
      const closed = host.attachShadow({ mode: 'closed', delegatesFocus: true });
      closed.innerHTML = `<input id="df" aria-label="df"><input id="di" aria-label="di">`;
      const frame = document.createElement('iframe');
      frame.srcdoc = `<!doctype html><button id="fb6">in frame</button>`;
      const loaded = new Promise((done) => frame.addEventListener('load', done, { once: true }));
      closed.appendChild(frame);
      await loaded;
      (closed.getElementById('di') as HTMLInputElement).focus();
      const before = document.activeElement?.id;
      const beforeInner = closed.activeElement?.id;
      await window.FV.captureStateVariations(frame.contentDocument!.getElementById('fb6')!, [
        'focus',
        'focus-visible',
      ]);
      return {
        before,
        beforeInner,
        after: document.activeElement === document.body ? 'body' : document.activeElement?.id,
        innerAfter:
          closed.activeElement === null
            ? null
            : closed.activeElement === frame
              ? 'frame'
              : closed.activeElement.id,
      };
    });
    // The closed tree encloses the frame, so its focus is read from the
    // frame's side and the input itself is restored. (Reading it from the
    // document only would record the host, and host.focus() would delegate to
    // its FIRST focusable element, df, instead.)
    expect(read).toEqual({
      before: 'closed-delegating-host',
      beforeInner: 'di',
      after: 'closed-delegating-host',
      innerAfter: 'di',
    });
    await page.close();
  }, 30_000);

  it('an ancestor focus inside a NON-focusable CLOSED host that encloses the frame: the input that had the focus gets it back', async () => {
    const page = await openPage();
    const read = await page.evaluate(async () => {
      const host = document.createElement('div');
      host.id = 'closed-plain-host';
      document.body.appendChild(host);
      const closed = host.attachShadow({ mode: 'closed' });
      closed.innerHTML = `<input id="pf" aria-label="pf"><input id="pi" aria-label="pi">`;
      const frame = document.createElement('iframe');
      frame.srcdoc = `<!doctype html><button id="fb7">in frame</button>`;
      const loaded = new Promise((done) => frame.addEventListener('load', done, { once: true }));
      closed.appendChild(frame);
      await loaded;
      (closed.getElementById('pi') as HTMLInputElement).focus();
      const before = closed.activeElement?.id;
      await window.FV.captureStateVariations(frame.contentDocument!.getElementById('fb7')!, [
        'focus',
        'focus-visible',
      ]);
      return {
        before,
        after: document.activeElement === document.body ? 'body' : document.activeElement?.id,
        innerAfter: closed.activeElement === frame ? 'frame' : (closed.activeElement?.id ?? null),
      };
    });
    // Read from the document alone, the recorded focus would be the host,
    // which takes no focus, so the input's focus would be lost to the body.
    expect(read).toEqual({ before: 'pi', after: 'closed-plain-host', innerAfter: 'pi' });
    await page.close();
  }, 30_000);

  it('a target below the fold: the read does not scroll the page', async () => {
    const page = await openPage();
    const read = await page.evaluate(async () => {
      const spacer = document.createElement('div');
      spacer.style.height = '3000px';
      document.body.appendChild(spacer);
      const target = document.createElement('button');
      target.id = 'below-fold';
      target.textContent = 'below the fold';
      document.body.appendChild(target);
      window.scrollTo(0, 0);
      const before = window.scrollY;
      const offscreen = target.getBoundingClientRect().top > window.innerHeight;
      const states = await window.FV.captureStateVariations(target, ['focus', 'focus-visible']);
      const fv = states.find((s: { state: string }) => s.state === 'focus-visible');
      return { before, offscreen, after: window.scrollY, forced: fv.forced };
    });
    expect(read).toEqual({ before: 0, offscreen: true, after: 0, forced: true });
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
