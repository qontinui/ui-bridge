// @vitest-environment node
/**
 * Real-Chromium proof of the canvas-aware occlusion measurement
 * (plan 2026-10-22-occlusion-sweep-is-blind-to-canvas-painted-text, Phase 1).
 *
 * jsdom has no layout and no `elementFromPoint`, so the jsdom suite
 * (registry.occlusion.test.ts) can only prove the plumbing against stubbed
 * geometry. Whether a REAL browser's hit-test sees an overlay over a stack of
 * canvas layers, ignores the layers themselves, and leaves a collapsed
 * `<details>` child alone is only answerable here.
 *
 * The page is built from the BUILT package (`dist/`, so `npm run build` must
 * have run, as ci.yml's browser-smokes job does first), bundled to one script
 * and injected with `page.addScriptTag`. The terminal container is registered
 * through `registry.registerElement` directly, not the React hook, because
 * that is how the runner registers its terminal surfaces.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright';
import { chromiumAvailable } from '../../../../../test-support/chromium-gate.mjs';
import type { UIBridgeRegistry } from '../registry';
import type { ElementState } from '../types';

const PLAYWRIGHT_AVAILABLE = chromiumAvailable();

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** What the injected script exposes on `window.__smoke`. */
interface SmokeApi {
  UIBridgeRegistry: new () => UIBridgeRegistry;
  createHandlers: (
    registry: unknown,
    executor: unknown,
    config: { idleDetection: false }
  ) => { visibility: (params?: { minRatio?: number }) => Promise<{ data?: unknown }> };
  DefaultActionExecutor: new (registry: UIBridgeRegistry) => unknown;
}

/** Bundle the built entry points the smoke needs into one classic script. */
async function bundleDist(): Promise<string> {
  for (const entry of [
    'dist/core/index.mjs',
    'dist/server/handlers.mjs',
    'dist/control/index.mjs',
  ]) {
    if (!existsSync(resolve(PACKAGE_DIR, entry))) {
      throw new Error(`${entry} is missing: run \`npm run build\` in packages/ui-bridge first.`);
    }
  }
  const out = await build({
    stdin: {
      contents: [
        "import { UIBridgeRegistry } from './dist/core/index.mjs';",
        "import { createHandlers } from './dist/server/handlers.mjs';",
        "import { DefaultActionExecutor } from './dist/control/index.mjs';",
        'window.__smoke = { UIBridgeRegistry, createHandlers, DefaultActionExecutor };',
      ].join('\n'),
      resolveDir: PACKAGE_DIR,
      loader: 'js',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  return out.outputFiles[0].text;
}

/**
 * (a) an 800x600 terminal-like container holding a text-layer canvas and a
 *     link-layer canvas on top of it, as xterm stacks them;
 * (b) a `position:fixed` z-40 card over its top-right corner;
 * (c) a 20px `position:absolute` strip over its bottom edge;
 * (d) a closed `<details>` whose child sits geometrically over the canvas.
 */
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; background: #fff; }
  canvas { position: absolute; left: 0; top: 0; width: 800px; height: 600px; }
</style></head><body>
  <div id="term" style="position:absolute; left:0; top:0; width:800px; height:600px;">
    <canvas class="xterm-text-layer" width="800" height="600"></canvas>
    <canvas class="xterm-link-layer" width="800" height="600"></canvas>
  </div>
  <div id="card" style="position:fixed; left:400px; top:16px; width:380px; height:260px; z-index:40; background:#c00; color:#fff;">error</div>
  <div id="strip" style="position:absolute; left:0; top:580px; width:800px; height:20px; z-index:40; background:#333; color:#fff;">status</div>
  <details id="det" style="position:absolute; left:100px; top:200px; z-index:50;">
    <summary>counts</summary>
    <div id="code" style="width:300px; height:60px;">dead: 0</div>
  </details>
</body></html>`;

describe.skipIf(!PLAYWRIGHT_AVAILABLE)('canvas-aware occlusion (real Chromium)', () => {
  let browser: Browser;
  let page: Page;
  let script: string;

  beforeAll(async () => {
    script = await bundleDist();
    browser = await chromium.launch({ headless: true });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
  }, 60_000);

  /** A fresh page with the fixture, the bundle, and `term` + `code` registered. */
  async function freshPage(): Promise<void> {
    page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    await page.setContent(FIXTURE);
    await page.addScriptTag({ content: script });
    await page.evaluate(() => {
      const api = (window as unknown as { __smoke: SmokeApi }).__smoke;
      const registry = new api.UIBridgeRegistry();
      (window as unknown as { __registry: UIBridgeRegistry }).__registry = registry;
      registry.registerElement('terminal-surface-a', document.getElementById('term')!, {
        type: 'canvas',
        category: 'content',
        label: 'Terminal: zone 1',
        paintsText: true,
      });
      registry.registerElement('content-code-block', document.getElementById('code')!, {
        type: 'generic',
      });
    });
  }

  /** The live state of a registered element, read in the page. */
  async function stateOf(id: string): Promise<ElementState> {
    return page.evaluate((elementId) => {
      const registry = (window as unknown as { __registry: UIBridgeRegistry }).__registry;
      const state = registry.getElement(elementId)!.getState();
      return JSON.parse(JSON.stringify(state)) as ElementState;
    }, id);
  }

  it('reports the fixed card over the terminal container, and never a canvas layer', async () => {
    await freshPage();
    try {
      const st = await stateOf('terminal-surface-a');
      expect(st.paintsText).toBe(true);
      expect(st.occludedBy).toBe('div#card');
      expect(st.occludedPct).toBeGreaterThan(0);
      // Descendant hits count as self: the link layer covers the text layer
      // and the container completely, and is never the occluder.
      expect(st.occludedBy).not.toMatch(/^canvas/);
      expect(st.visible).toBe(true);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('still detects the bottom strip once the card is removed: the dense grid edge row', async () => {
    await freshPage();
    try {
      await page.evaluate(() => document.getElementById('card')!.remove());
      const st = await stateOf('terminal-surface-a');
      expect(st.occludedBy).toBe('div#strip');
      expect(st.occludedBy).not.toMatch(/^canvas/);

      // With nothing over it at all, nothing is blamed — not a canvas layer.
      await page.evaluate(() => document.getElementById('strip')!.remove());
      const clear = await stateOf('terminal-surface-a');
      expect(clear.occludedBy).toBeUndefined();
      expect(clear.visible).toBe(true);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('reports the closed <details> child hidden with no occluder, and hit-tests it once open', async () => {
    await freshPage();
    try {
      const closed = await stateOf('content-code-block');
      expect(closed.visible).toBe(false);
      expect(closed.visibilityReason).toBe('hidden');
      expect(closed.occludedBy).toBeUndefined();

      // Open it and lay a fixed div over the child: the hit-test runs again.
      await page.evaluate(() => {
        document.getElementById('det')!.setAttribute('open', '');
        const over = document.createElement('div');
        over.id = 'over-code';
        over.style.cssText =
          'position:fixed; left:100px; top:200px; width:400px; height:200px; z-index:60; background:#00c;';
        document.body.appendChild(over);
      });
      const open = await stateOf('content-code-block');
      expect(open.visibilityReason).toBe('occluded');
      expect(open.occludedBy).toBe('div#over-code');
    } finally {
      await page.close();
    }
  }, 60_000);

  it('logs what the dense grid costs per paintsText surface', async () => {
    await freshPage();
    try {
      // The same node read as a paintsText surface (81 probes) and as an
      // ordinary element (9 probes): the difference is the dense grid's cost.
      const { dense, plain } = await page.evaluate(() => {
        const api = (window as unknown as { __smoke: SmokeApi }).__smoke;
        const registry = (window as unknown as { __registry: UIBridgeRegistry }).__registry;
        const surface = registry.getElement('terminal-surface-a')!;
        const ordinary = new api.UIBridgeRegistry().registerElement(
          'terminal-plain',
          document.getElementById('term')!,
          { type: 'generic', paintsText: false }
        );
        const perRead = (read: () => unknown): number => {
          const runs = 200;
          for (let i = 0; i < 20; i++) read();
          const t0 = performance.now();
          for (let i = 0; i < runs; i++) read();
          return (performance.now() - t0) / runs;
        };
        return {
          dense: perRead(() => surface.getState()),
          plain: perRead(() => ordinary.getState()),
        };
      });
      console.log(
        `[smoke] getState() per read: paintsText ${dense.toFixed(3)} ms (81 probes), ` +
          `ordinary ${plain.toFixed(3)} ms (9 probes), dense-grid cost ${(dense - plain).toFixed(3)} ms`
      );
      expect(dense).toBeGreaterThan(0);
      expect(plain).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  }, 60_000);
});
