// @vitest-environment node
/**
 * Real-Chromium proof of the request-scoped projection
 * (`core/element-projection.ts`, plan
 * 2026-11-09-ui-bridge-relay-evaluates-vision-assertions-in-the-tab, Phase 2).
 *
 * jsdom does not cascade: it leaves `var()` unresolved, inherits no custom
 * property from `:root`, does not expand the `outline` shorthand and does not
 * map a logical longhand onto its physical side. Every case here reads what a
 * real engine computes, through the two code paths that read a page:
 *   - the in-process server handlers (`createHandlers(...).find` /
 *     `.getElementState`), and
 *   - the relay's in-page dispatcher (`executeCommand('find' | 'getElementState'
 *     | 'aiAssertBatch')`), which is what a relay request runs in the tab.
 * Both must answer the same values. The relay's server half — that the names
 * travel to the tab and the values back — is pinned over HTTP in
 * `server/element-projection.transports.test.ts`.
 *
 * The SDK modules under test are bundled from source with esbuild and injected
 * into each page as `window.UB`.
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

const files = new Map<string, { type: string; body: string }>();
let server: Server;
let origin: string;
let browser: Browser;
let bundle: string;

/** The page: design tokens on `:root`, a card styled through them, and a redaction boundary. */
const PAGE = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
  :root { --brand: #00aaff; --space: 3px; }
  .card {
    border: 1px solid var(--brand);
    border-inline-start: 4px solid rgb(200, 0, 0);
    outline: 2px dashed var(--brand);
    outline-offset: var(--space);
    hyphens: auto;
    color: var(--brand);
    --tone: var(--brand);
  }
  .avatar { background-image: url("/a.png?token=s3cret"); width: 10px; height: 10px; }
</style></head><body>
  <div class="card" id="card" dir="rtl" title="Karte">Silbentrennung</div>
  <div data-bridge-redact="true"><div class="card avatar" id="secret">x</div></div>
</body></html>`;

/** What Chromium computes for `#card`. */
const CARD = {
  'border-top-color': 'rgb(0, 170, 255)',
  // `dir="rtl"`: the inline-start side is the right one.
  'border-inline-start-color': 'rgb(200, 0, 0)',
  'border-right-color': 'rgb(200, 0, 0)',
  'border-left-color': 'rgb(0, 170, 255)',
  'outline-color': 'rgb(0, 170, 255)',
  'outline-style': 'dashed',
  'outline-width': '2px',
  'outline-offset': '3px',
  hyphens: 'auto',
  // Inherited from `:root`, and resolved through `var()`.
  '--brand': '#00aaff',
  '--tone': '#00aaff',
  borderTopColor: 'rgb(0, 170, 255)',
};

beforeAll(async () => {
  if (!PLAYWRIGHT_AVAILABLE) return;
  const out = await build({
    stdin: {
      contents: `
        import { getGlobalRegistry } from './core/registry';
        export { createHandlers } from './server/handlers';
        export { executeCommand } from './react/commandHandlers';
        import { createActionExecutor } from './control/action-executor';
        import { createHandlers } from './server/handlers';
        /** Register every [id] element under its id. */
        export function registerAll() {
          const registry = getGlobalRegistry();
          for (const el of Array.from(document.querySelectorAll('body [id]'))) {
            registry.registerElement(el.id, el, { type: 'generic', label: el.id });
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
        export function inProcess() {
          const registry = getGlobalRegistry();
          return createHandlers(
            {
              getAllElements: () => registry.getAllElements(),
              getElement: (id) => registry.getElement(id),
              getAllComponents: () => registry.getAllComponents(),
              getComponent: (id) => registry.getComponent(id),
              createSnapshot: () => registry.createSnapshot(),
            },
            createActionExecutor(registry)
          );
        }
      `,
      resolveDir: SRC,
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    globalName: 'UB',
    platform: 'browser',
    target: 'chrome120',
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

async function openPage(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(`${origin}/page`);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => window.UB.registerAll());
  return page;
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    UB: any;
  }
}

type Projection = {
  properties?: Record<string, string>;
  attributes?: Record<string, string | null>;
  unmeasured: Array<{ name: string; code: string }>;
};

describe.skipIf(!PLAYWRIGHT_AVAILABLE)('the projection reads what Chromium computes', () => {
  it('find: both arms answer every longhand, the logical side, and var()-resolved tokens', async () => {
    const page = await openPage();
    const properties = Object.keys(CARD);
    const { inProcess, relay } = await page.evaluate(async (props) => {
      const request = { skipSettle: true, properties: props, attributes: ['lang', 'dir', 'title'] };
      const viaHandlers = await window.UB.inProcess().find(request);
      const viaRelay = await window.UB.executeCommand('find', request, window.UB.bridge());
      const pick = (rows: Array<{ id: string; projection?: unknown }>) =>
        rows.find((r) => r.id === 'card')?.projection;
      return {
        inProcess: pick(viaHandlers.data.elements),
        relay: pick(viaRelay.elements),
      };
    }, properties);
    const expected: Projection = {
      properties: CARD,
      attributes: { lang: null, dir: 'rtl', title: 'Karte' },
      unmeasured: [],
    };
    expect(inProcess).toEqual(expected);
    expect(relay).toEqual(expected);
    await page.close();
  }, 60_000);

  it('element state: both arms answer the projection off the live element', async () => {
    const page = await openPage();
    const { inProcess, relay } = await page.evaluate(async () => {
      const viaHandlers = await window.UB.inProcess().getElementState('card', undefined, {
        properties: 'outline-offset,--tone,border-inline-start-color',
      });
      const viaRelay = await window.UB.executeCommand(
        'getElementState',
        { id: 'card', properties: ['outline-offset', '--tone', 'border-inline-start-color'] },
        window.UB.bridge()
      );
      return { inProcess: viaHandlers.data.projection, relay: viaRelay.projection };
    });
    const expected: Projection = {
      properties: {
        'outline-offset': '3px',
        '--tone': '#00aaff',
        'border-inline-start-color': 'rgb(200, 0, 0)',
      },
      unmeasured: [],
    };
    expect(inProcess).toEqual(expected);
    expect(relay).toEqual(expected);
    await page.close();
  }, 60_000);

  it('a name the engine does not compute, and a token the element does not set, are unmeasured', async () => {
    const page = await openPage();
    const projection = await page.evaluate(async () => {
      const reply = await window.UB.executeCommand(
        'getElementState',
        { id: 'card', properties: ['colr', '--unset'] },
        window.UB.bridge()
      );
      return reply.projection;
    });
    expect(projection.properties).toEqual({});
    expect(
      projection.unmeasured.map((u: { name: string; code: string }) => [u.name, u.code])
    ).toEqual([
      ['colr', 'capability_unavailable_in_build'],
      ['--unset', 'input_missing'],
    ]);
    await page.close();
  }, 60_000);

  it('inside a redaction boundary, colours pass and tokens and url() values are scrubbed', async () => {
    const page = await openPage();
    const projection = await page.evaluate(async () => {
      const reply = await window.UB.executeCommand(
        'getElementState',
        { id: 'secret', properties: ['border-top-color', '--tone', 'background-image'] },
        window.UB.bridge()
      );
      return reply.projection;
    });
    expect(projection).toEqual({
      properties: {
        'border-top-color': 'rgb(0, 170, 255)',
        '--tone': '[REDACTED]',
        'background-image': '[REDACTED]',
      },
      unmeasured: [],
    });
    await page.close();
  }, 60_000);

  it('ai/assert reads its cssProperty* checks through the projection in a real page', async () => {
    const page = await openPage();
    const result = await page.evaluate(async () =>
      window.UB.executeCommand(
        'aiAssertBatch',
        {
          mode: 'all',
          assertions: [
            { target: 'card', type: 'cssProperty', propertyName: '--tone', expected: '#00aaff' },
            {
              target: 'card',
              type: 'cssProperty',
              propertyName: 'border-inline-start-color',
              expected: 'rgb(200, 0, 0)',
            },
            {
              target: 'card',
              type: 'cssPropertyInSet',
              propertyName: 'outline-style',
              allowedValues: ['solid', 'dashed'],
            },
            { target: 'card', type: 'attribute', attributeName: 'dir', expected: 'rtl' },
          ],
        },
        window.UB.bridge()
      )
    );
    expect(result.results.map((r: { outcome: string }) => r.outcome)).toEqual([
      'passed',
      'passed',
      'passed',
      'passed',
    ]);
    expect(result).toMatchObject({ passed: true, failedCount: 0, unmeasuredCount: 0 });
    await page.close();
  }, 60_000);

  it('the document sentinel reads <html> — its :root tokens and lang — on both arms', async () => {
    const page = await openPage();
    const { inProcess, relay, asserted, registered } = await page.evaluate(async () => {
      const viaHandlers = await window.UB.inProcess().getElementState('document', undefined, {
        properties: '--brand,--space',
        attributes: 'lang',
      });
      const viaRelay = await window.UB.executeCommand(
        'getElementState',
        { id: 'document', properties: ['--brand', '--space'], attributes: ['lang'] },
        window.UB.bridge()
      );
      const batch = await window.UB.executeCommand(
        'aiAssertBatch',
        {
          mode: 'all',
          assertions: [
            { target: 'document', type: 'attribute', attributeName: 'lang', expected: 'de' },
            {
              target: 'document',
              type: 'cssProperty',
              propertyName: '--brand',
              expected: '#00aaff',
            },
          ],
        },
        window.UB.bridge()
      );
      return {
        inProcess: viaHandlers.data,
        relay: viaRelay,
        asserted: batch,
        registered: window.UB.bridge().elements.some(
          (e: { element: Element }) => e.element === document.documentElement
        ),
      };
    });
    const expected = {
      id: 'document',
      sentinel: 'document',
      tagName: 'html',
      projection: {
        properties: { '--brand': '#00aaff', '--space': '3px' },
        attributes: { lang: 'de' },
        unmeasured: [],
      },
    };
    expect(inProcess).toEqual(expected);
    expect(relay).toEqual(expected);
    expect(asserted).toMatchObject({ passed: true, passedCount: 2, unmeasuredCount: 0 });
    // <html> is read through the sentinel, never registered.
    expect(registered).toBe(false);
    await page.close();
  }, 60_000);
});
