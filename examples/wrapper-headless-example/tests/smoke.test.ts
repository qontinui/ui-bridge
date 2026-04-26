/**
 * End-to-end smoke for the headless Playwright transport.
 *
 * Pipeline:
 *   1. Start a local HTTP server serving `tests/fixtures/page.html` on a
 *      random port.
 *   2. Construct `HeadlessTransport` pointed at that server.
 *   3. Register the example's handlers via `registerHandlers(transport)`.
 *   4. Dispatch each action and assert the page state matches expectations.
 *   5. Tear down (transport + server) regardless of test outcome.
 *
 * The test only exercises the headless path; flipping to headed for CI
 * would require an X server / display, which CI usually doesn't have.
 * Adopters can still drive the headed path manually via `HEADED=1 npm start`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HeadlessTransport, type WrapperTransport } from '@qontinui/ui-bridge-wrapper';
import { registerHandlers } from '../src/handlers.js';
import type {
  HeadingTextResult,
  ClickButtonResult,
  FillInputResult,
  ScreenshotResult,
  MetricsResult,
} from '../src/handlers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, 'fixtures/page.html');
const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 640;

let server: Server | null = null;
let serverPort = 0;
let transport: WrapperTransport | null = null;

async function startServer(): Promise<void> {
  const html = await readFile(FIXTURE_PATH, 'utf-8');
  server = createServer((req, res) => {
    // Serve the fixture for `/` and `/page.html`; 404 for anything else.
    if (req.url === '/' || req.url === '/page.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
  await new Promise<void>((res, rej) => {
    server!.once('error', rej);
    server!.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      if (addr === null || typeof addr === 'string') {
        rej(new Error('Failed to obtain server port'));
        return;
      }
      serverPort = addr.port;
      res();
    });
  });
}

async function stopServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((res) => server!.close(() => res()));
  server = null;
}

beforeAll(async () => {
  await startServer();
}, 90_000);

afterAll(async () => {
  if (transport) {
    try {
      await transport.close();
    } catch {
      // best-effort
    }
    transport = null;
  }
  await stopServer();
}, 30_000);

describe('wrapper-headless-example (HeadlessTransport)', () => {
  it('drives a real Chromium against a local fixture and observes DOM state changes', async () => {
    transport = new HeadlessTransport({
      kind: 'headless',
      options: {
        targetUrl: `http://127.0.0.1:${serverPort}/`,
        viewportWidth: VIEWPORT_WIDTH,
        viewportHeight: VIEWPORT_HEIGHT,
        forwardConsole: false,
      },
    });
    registerHandlers(transport);
    await transport.ready();

    // 1. Heading reads "Initial heading" before the click.
    const heading = await transport.dispatch<HeadingTextResult>('getHeadingText');
    expect(heading.text).toBe('Initial heading');

    // 2. Clicking the primary button mutates the heading.
    const click = await transport.dispatch<ClickButtonResult>('clickButton');
    expect(click.clicked).toBe(true);
    expect(click.beforeText).toBe('Initial heading');
    expect(click.afterText).toBe('Heading clicked');
    expect(click.beforeText).not.toBe(click.afterText);

    // 3. fillInput round-trips: read-back equals what we wrote.
    const fill = await transport.dispatch<FillInputResult>('fillInput', {
      value: 'test@example.com',
    });
    expect(fill.value).toBe('test@example.com');
    expect(fill.currentValue).toBe('test@example.com');

    // 4. screenshot returns a non-trivial PNG byte count.
    const shot = await transport.dispatch<ScreenshotResult>('screenshot');
    expect(typeof shot.bytes).toBe('number');
    expect(shot.bytes).toBeGreaterThan(0);

    // 5. getMetrics: viewport matches what we asked for; UA is Chromium-shaped.
    const metrics = await transport.dispatch<MetricsResult>('getMetrics');
    expect(metrics.viewport).not.toBeNull();
    expect(metrics.viewport!.width).toBe(VIEWPORT_WIDTH);
    expect(metrics.viewport!.height).toBe(VIEWPORT_HEIGHT);
    expect(metrics.url).toContain(`127.0.0.1:${serverPort}`);
    // Playwright Chromium identifies as either HeadlessChrome or Chrome — accept either.
    expect(metrics.userAgent).toMatch(/HeadlessChrome|Chrome/);
  });
});
