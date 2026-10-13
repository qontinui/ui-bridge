/**
 * Real-Chromium read-back of the context emulation options.
 *
 * The page itself is the authority: `window.devicePixelRatio` must read the
 * requested factor, `prefers-color-scheme` must match, and a viewport
 * screenshot must be `viewport × deviceScaleFactor` pixels. A Chromium launch
 * flag passed the same factor does NOT pass this test — that is the measured
 * Phase 1 defect this option exists to avoid (plan
 * 2026-10-13-image-generation-and-visual-judgment, Phase 1 item 5).
 *
 * Gated on a Playwright Chromium being installed, the same convention the
 * wrapper's smokes use.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { launchHeadlessTab } from './launcher.js';
import { chromiumAvailable } from '../../../test-support/chromium-gate.mjs';

const PLAYWRIGHT_AVAILABLE = chromiumAvailable(import.meta.url);

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>dpr</title>
<style>html,body{margin:0;background:#fff}@media (prefers-color-scheme: dark){html,body{background:#000}}</style>
</head><body><p>dpr probe</p></body></html>`;

let server: Server;
let url: string;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** PNG IHDR width/height (big-endian u32 at byte 16 and 20). */
function pngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe.skipIf(!PLAYWRIGHT_AVAILABLE)('launchHeadlessTab emulation (real Chromium)', () => {
  it('deviceScaleFactor 2 + dark: the page reads devicePixelRatio 2 and a dark scheme, and the frame is 2x', async () => {
    const tab = await launchHeadlessTab({
      url,
      headless: true,
      viewportWidth: 400,
      viewportHeight: 300,
      deviceScaleFactor: 2,
      colorScheme: 'dark',
      forwardConsole: false,
    });
    try {
      const read = await tab.page.evaluate(() => ({
        dpr: window.devicePixelRatio,
        dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
        innerWidth: window.innerWidth,
      }));
      expect(read).toEqual({ dpr: 2, dark: true, innerWidth: 400 });
      const png = await tab.page.screenshot({ type: 'png', scale: 'device' });
      expect(pngSize(png)).toEqual({ width: 800, height: 600 });
    } finally {
      await tab.close();
    }
  }, 60_000);

  it('with neither option the page keeps Playwright defaults: devicePixelRatio 1, light', async () => {
    const tab = await launchHeadlessTab({
      url,
      headless: true,
      viewportWidth: 400,
      viewportHeight: 300,
      forwardConsole: false,
    });
    try {
      const read = await tab.page.evaluate(() => ({
        dpr: window.devicePixelRatio,
        dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
      }));
      expect(read).toEqual({ dpr: 1, dark: false });
    } finally {
      await tab.close();
    }
  }, 60_000);
});
