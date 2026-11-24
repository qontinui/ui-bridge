// @vitest-environment node
/**
 * Real-Chromium reading of a control snapshot the SDK itself serialized from a
 * laid-out page, through the density snapshot adapter (plan
 * 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change,
 * Phase 2).
 *
 * Phase 1's fixtures are typed against `ControlSnapshot`, whose element fields
 * are nearly all optional, and its contract test runs under jsdom, which lays
 * nothing out. So this is the first observation that can FALSIFY the premise
 * the model rests on: that a snapshot carries, for a real page, document-space
 * geometry, font size, line height, position, truncation, redaction, the xpath
 * that structure is read from, and the viewport block. Each expectation is a
 * literal that follows from the page's own CSS.
 *
 * The snapshot is the relay's in-page `getControlSnapshot` answer — what a
 * relay or runner serves as `GET /control/snapshot` — read at 360x740 and
 * 1280x800, unscrolled and scrolled. The SDK modules are bundled from source
 * with esbuild and injected into the page as `window.UB` (the precedent is
 * `core/element-projection.smoke.test.ts`). Every id and text is synthetic.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser } from 'playwright';
import { chromiumAvailable } from '../../../test-support/chromium-gate.mjs';
import { captureDensityFromSnapshot } from './density';
import type { DensityCapture, DensityItem } from './density';

const PLAYWRIGHT_AVAILABLE = chromiumAvailable();

const HERE = dirname(fileURLToPath(import.meta.url));

const PRODUCER = { id: 'sdk/density', version: 'smoke', package: '@qontinui/ui-bridge' } as const;

/**
 * The page. Body margin 0; a fixed 48 px header; `main` padded 48 px from the
 * top, so the first order row starts at document y 48. Rows are 20 px tall
 * (14 px font, 20 px line height), the truncated label 16 px (12 px / 16 px),
 * then a redaction boundary holding one 20 px row, then a tall spacer so the
 * page scrolls. The order rows carry no DOM id, so their xpath is a chain from
 * the `section#orders` ancestor. Registration ids come from `data-reg`.
 */
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; font-family: sans-serif; }
  header { position: fixed; top: 0; left: 0; right: 0; height: 48px; font-size: 16px; line-height: 24px; }
  main { padding-top: 48px; }
  .row { font-size: 14px; line-height: 20px; height: 20px; margin: 0; }
  .trunc { width: 80px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
           font-size: 12px; line-height: 16px; height: 16px; }
  .spacer { height: 2000px; }
</style></head><body>
  <header data-reg="app.header.bar">Synthetic Shop</header>
  <main>
    <section id="orders" data-reg="app.orders">
      <div class="row" data-reg="app.orders.open-1">Order 4711 needs action</div>
      <div class="row" data-reg="app.orders.open-2">Order 4712 ready</div>
    </section>
    <div class="trunc" data-reg="app.label.long">A synthetic label much longer than eighty pixels</div>
    <div data-bridge-redact="true"><div class="row" data-reg="app.secret">synthetic secret text</div></div>
    <div class="spacer"></div>
  </main>
</body></html>`;

const files = new Map<string, { type: string; body: string }>();
let server: Server;
let origin: string;
let browser: Browser;
let bundle: string;

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    UB: any;
  }
}

beforeAll(async () => {
  if (!PLAYWRIGHT_AVAILABLE) return;
  const out = await build({
    stdin: {
      contents: `
        import { getGlobalRegistry } from './core/registry';
        export { executeCommand } from './react/commandHandlers';
        /** Register every [data-reg] element under that id. */
        export function registerAll() {
          const registry = getGlobalRegistry();
          for (const el of Array.from(document.querySelectorAll('[data-reg]'))) {
            registry.registerElement(el.getAttribute('data-reg'), el, { type: 'generic', label: el.getAttribute('data-reg') });
          }
        }
        export function bridge() {
          const registry = getGlobalRegistry();
          return {
            elements: registry.getAllElements(),
            getElement: (id) => registry.getElement(id),
            components: [],
            workflows: [],
          };
        }
      `,
      resolveDir: HERE,
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    globalName: 'UB',
    platform: 'browser',
    target: 'chrome120',
    external: ['@qontinui/ui-bridge-headless'],
    write: false,
    logLevel: 'silent',
    define: { __SDK_VERSION__: '"smoke"', 'process.env.NODE_ENV': '"test"' },
  });
  bundle = out.outputFiles[0].text;
  files.set('/page', { type: 'text/html; charset=utf-8', body: PAGE });
  server = createServer((req, res) => {
    const file = files.get((req.url ?? '/').split('?')[0]);
    if (!file) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': file.type, 'cache-control': 'no-store' });
    res.end(file.body);
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

/** The in-page `getControlSnapshot` answer at one viewport and scroll position. */
async function snapshotAt(width: number, height: number, scrollY: number): Promise<unknown> {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.goto(`${origin}/page`);
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => window.UB.registerAll());
    await page.evaluate((y) => window.scrollTo(0, y), scrollY);
    await page.waitForFunction((y) => window.scrollY === y, scrollY);
    return await page.evaluate(() =>
      window.UB.executeCommand('getControlSnapshot', {}, window.UB.bridge())
    );
  } finally {
    await page.close();
  }
}

function captureOf(snapshot: unknown): DensityCapture {
  const obs = captureDensityFromSnapshot(snapshot, { producer: PRODUCER, role: 'buyer' });
  if (obs.status !== 'measured') {
    throw new Error(`capture was ${obs.status}: ${JSON.stringify(obs)}`);
  }
  return obs.value;
}

function item(capture: DensityCapture, id: string): DensityItem {
  const found = capture.items.find((i) => i.id === id);
  if (!found) throw new Error(`no item ${id} in the capture`);
  return found;
}

type RawElement = { id: string; identifier?: { xpath?: string } };

const CELLS = [
  { width: 360, height: 740, scrollY: 0 },
  { width: 360, height: 740, scrollY: 300 },
  { width: 1280, height: 800, scrollY: 0 },
  { width: 1280, height: 800, scrollY: 300 },
] as const;

describe.skipIf(!PLAYWRIGHT_AVAILABLE)(
  'a laid-out snapshot carries what the density model needs',
  () => {
    it.each(CELLS)(
      'at $width x $height scrolled to $scrollY: geometry, type, truncation, redaction, xpath and viewport',
      async ({ width, height, scrollY }) => {
        const snapshot = await snapshotAt(width, height, scrollY);
        const capture = captureOf(snapshot);

        // The viewport block, as the page reports it: 48 + 2*20 + 16 + 20 + 2000 = 2124 px tall.
        expect(capture.viewport).toEqual({
          width,
          height,
          scrollX: 0,
          scrollY,
          documentWidth: width,
          documentHeight: 2124,
          container: 'viewport',
        });
        expect(capture.bases.foldBasis).toBe(scrollY === 0 ? 'measured' : 'reprojected');
        expect(capture.bases.scrollBasis).toBe('page');

        // Document-space y holds still under scroll: y = rect.y + scrollY.
        const open1 = item(capture, 'app.orders.open-1');
        expect(open1.rect).toEqual({ x: 0, y: 48, w: width, h: 20 });
        expect(item(capture, 'app.orders.open-2').rect).toEqual({ x: 0, y: 68, w: width, h: 20 });
        expect(open1.fontPx).toBe(14);
        expect(open1.lineHeightPx).toBe(20);
        expect(open1.position).toBe('static');
        expect(open1.visibility).toBe('rendered');
        expect(open1.chars).toBe(23);
        expect(open1.truncated).toBe(false);

        // A fixed bar's viewport y is 0 at any scroll, so its document y is the scroll.
        const header = item(capture, 'app.header.bar');
        expect(header.position).toBe('fixed');
        expect(header.rect).toEqual({ x: 0, y: scrollY, w: width, h: 48 });
        expect(header.fontPx).toBe(16);
        expect(header.lineHeightPx).toBe(24);

        // The truncated label: 80 px wide, overflow hidden, text wider than the box.
        const label = item(capture, 'app.label.long');
        expect(label.rect).toEqual({ x: 0, y: 88, w: 80, h: 16 });
        expect(label.truncated).toBe(true);
        expect(label.recoverable).toBe(null);
        expect(label.fontPx).toBe(12);
        expect(label.lineHeightPx).toBe(16);

        // The redacted subtree: geometry measured, text never read.
        const secret = item(capture, 'app.secret');
        expect(secret.rect).toEqual({ x: 0, y: 104, w: width, h: 20 });
        expect(secret.chars).toBe(null);
        expect(secret.textHash).toBe(null);
        expect(secret.shape).toBe(null);
        expect(JSON.stringify(capture)).not.toContain('synthetic secret text');

        // Structure is read from the xpath: the order rows have no DOM id, so
        // their chain starts at the registered `section#orders`.
        expect(open1.structureBy).toBe('xpath');
        const raw = (snapshot as { elements: RawElement[] }).elements;
        const xpathOf = (id: string) => raw.find((e) => e.id === id)?.identifier?.xpath;
        expect(xpathOf('app.orders')).toBe('//*[@id="orders"]');
        expect(xpathOf('app.orders.open-1')).toBe('/section[@id="orders"]/div[1]');
        expect(xpathOf('app.orders.open-2')).toBe('/section[@id="orders"]/div[2]');
        // The structure pass reads that chain: the rows' parent is the section
        // their chain is anchored at, and the section's own-id xpath names no
        // ancestor.
        expect(open1.parent).toBe('app.orders');
        expect(open1.path).toEqual(['section']);
        expect(item(capture, 'app.orders').structureBy).toBe('geometry');
      },
      60_000
    );
  }
);
