/**
 * Real-Chromium read-back of the context passthrough options.
 *
 * - `recordHar`: after `tab.close()` resolves, the archive exists on disk and
 *   lists the page's own requests. Playwright writes it on CONTEXT close, so a
 *   launcher that closed only the browser would leave no file here.
 * - `recordVideo`: after `tab.close()` resolves, the tab's video file exists in
 *   the requested `dir`, is non-empty, and is named by `page.video().path()`.
 * - `initRouter`: a route it installs intercepts the FIRST navigation's
 *   document request, so the page shows the routed body and the fixture server
 *   never sees that request.
 *
 * Gated on a Playwright Chromium being installed, the same convention the
 * other smokes use.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchHeadlessTab } from './launcher.js';
import { chromiumAvailable } from '../../../test-support/chromium-gate.mjs';

const PLAYWRIGHT_AVAILABLE = chromiumAvailable();

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>har</title>
<link rel="stylesheet" href="/style.css"></head><body><p id="t">served</p></body></html>`;

let server: Server;
let url: string;
let dir: string;
const served: string[] = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ui-bridge-headless-context-options-'));
  server = createServer((req, res) => {
    served.push(req.url ?? '');
    if (req.url === '/style.css') {
      res.writeHead(200, { 'content-type': 'text/css' });
      res.end('p { color: rgb(1, 2, 3); }');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!PLAYWRIGHT_AVAILABLE)('launchHeadlessTab context options (real Chromium)', () => {
  it('recordHar (with serviceWorkers passed through): the HAR exists after close() and lists the document and its CSS', async () => {
    const harPath = join(dir, 'capture.har');
    const tab = await launchHeadlessTab({
      url,
      headless: true,
      forwardConsole: false,
      recordHar: { path: harPath, mode: 'minimal' },
      serviceWorkers: 'block',
    });
    try {
      expect(await tab.page.textContent('#t')).toBe('served');
    } finally {
      await tab.close();
    }

    expect(existsSync(harPath)).toBe(true);
    const har = JSON.parse(readFileSync(harPath, 'utf8')) as {
      log: { entries: { request: { url: string } }[] };
    };
    const urls = har.log.entries.map((e) => e.request.url);
    expect(urls).toContain(url);
    expect(urls).toContain(`${url}style.css`);
  }, 60_000);

  it('recordVideo: the tab video exists in dir after close() and is named by page.video()', async () => {
    const videoDir = join(dir, 'videos');
    const tab = await launchHeadlessTab({
      url,
      headless: true,
      forwardConsole: false,
      viewportWidth: 640,
      viewportHeight: 360,
      recordVideo: { dir: videoDir },
    });
    let videoPath: string | undefined;
    try {
      expect(await tab.page.textContent('#t')).toBe('served');
      videoPath = await tab.page.video()?.path();
    } finally {
      await tab.close();
    }

    expect(videoPath).toBeDefined();
    expect(videoPath!.startsWith(videoDir)).toBe(true);
    expect(existsSync(videoPath!)).toBe(true);
    expect(statSync(videoPath!).size).toBeGreaterThan(0);
  }, 60_000);

  it('a route installed by initRouter intercepts the first navigation', async () => {
    served.length = 0;
    const tab = await launchHeadlessTab({
      url,
      headless: true,
      forwardConsole: false,
      initRouter: async (context) => {
        await context.route('**/*', (route) =>
          route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><p id="t">routed</p>',
          })
        );
      },
    });
    try {
      expect(await tab.page.textContent('#t')).toBe('routed');
    } finally {
      await tab.close();
    }
    expect(served).toEqual([]);
  }, 60_000);
});
