/**
 * Real Chromium: inject-cli's frame flags and capture matrix, end to end
 * through the same functions the bin runs (`buildTransportOptions`,
 * `registerFrameCapture`, `executeActions`, `captureMatrix`).
 *
 * What is proved ON THE PAGE AND IN THE PIXELS, not inferred from flags:
 *   - `--dpr 2` makes the page read `window.devicePixelRatio` 2 — the measured
 *     Phase 1 defect was a launch flag that left it at 1;
 *   - the frame is `viewport × DPR` pixels and stamps the page's own DPR,
 *     colour scheme and CSS viewport, verified in lockstep;
 *   - the snapshot's CSS-pixel box of a red button lands on red frame pixels
 *     only once scaled by the DPR — the unscaled position is the dark page.
 *     That is the bbox → frame-pixel mapping the vision analyzers rely on
 *     (qontinui-schemas `FrameSource.scale_factor`).
 *
 * Gated on a Playwright Chromium being installed, as the other smokes are.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTransport } from '../src/create-transport.js';
import {
  SNAPSHOT_ACTIONS,
  buildTransportOptions,
  captureMatrix,
  executeActions,
  parseArgs,
  registerFrameCapture,
  validateFramePlan,
  type ExecLine,
} from '../src/inject-cli.js';
import { expandFramePath } from '../src/frame-capture.js';
import { chromiumAvailable } from '../../../test-support/chromium-gate.mjs';

const PLAYWRIGHT_AVAILABLE = chromiumAvailable(import.meta.url);

// A red button at CSS (50,40) 100x60 on a page that is black in dark mode.
// The label is red on red so every pixel inside the box is the same colour.
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>frame</title>
<style>
html,body{margin:0;background:#fff}
@media (prefers-color-scheme: dark){html,body{background:#000}}
#go{position:absolute;left:50px;top:40px;width:100px;height:60px;margin:0;padding:0;
border:0;border-radius:0;background:rgb(255,0,0);color:rgb(255,0,0);font:12px sans-serif}
</style></head><body><button id="go">Go</button></body></html>`;

/** Decode an 8-bit, non-interlaced RGB/RGBA PNG (what Chromium writes) to RGBA rows. */
function decodePng(buf: Buffer): {
  width: number;
  height: number;
  px: (x: number, y: number) => number[];
} {
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24]!;
  const colorType = buf[25]!;
  const interlace = buf[28]!;
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
    throw new Error(
      `unsupported PNG: depth ${bitDepth} colour ${colorType} interlace ${interlace}`
    );
  }
  const bpp = colorType === 6 ? 4 : 3;
  const idat: Buffer[] = [];
  for (let off = 8; off < buf.length; ) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i]!;
      const a = i >= bpp ? out[y * stride + i - bpp]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + i]! : 0;
      const c = i >= bpp && y > 0 ? out[(y - 1) * stride + i - bpp]! : 0;
      let v: number;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[y * stride + i] = v & 0xff;
    }
  }
  return {
    width,
    height,
    px: (x, y) => Array.from(out.subarray(y * stride + x * bpp, y * stride + x * bpp + 3)),
  };
}

let server: Server;
let url: string;
let dir: string;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  dir = mkdtempSync(join(tmpdir(), 'inject-frame-smoke-'));
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

type El = { id: string; bbox?: { x: number; y: number; width: number; height: number } };

describe.skipIf(!PLAYWRIGHT_AVAILABLE)('inject-cli frames (real Chromium)', () => {
  it('--dpr 2 --color-scheme dark --screenshot: the page reads DPR 2 and the snapshot box lands on its own pixels only when scaled', async () => {
    const args = parseArgs([
      '--url',
      url,
      '--exec',
      'getControlSnapshot {}',
      '--viewport',
      '400x300',
      '--dpr',
      '2',
      '--color-scheme',
      'dark',
      '--screenshot',
      join(dir, 'exec', 'frame-{n}.png'),
      '--quiet',
    ]);
    validateFramePlan(args.execActions, args.screenshot);
    const transport = createTransport({ kind: 'injected', options: buildTransportOptions(args) });
    registerFrameCapture(transport);
    transport.register('__probe', (_p: unknown, ctx: unknown) =>
      (ctx as { page: { evaluate<R>(fn: () => R): Promise<R> } }).page.evaluate(() => ({
        dpr: window.devicePixelRatio,
        dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
      }))
    );
    const lines: ExecLine[] = [];
    try {
      await transport.ready();
      // The page itself is the authority on the emulation.
      expect(await transport.dispatch('__probe')).toEqual({ dpr: 2, dark: true });

      const screenshot = args.screenshot!;
      const anyError = await executeActions(
        transport,
        args.execActions,
        (position, action) =>
          SNAPSHOT_ACTIONS.has(action) ? expandFramePath(screenshot, position) : null,
        (line) => lines.push(line)
      );
      expect(anyError).toBe(false);
    } finally {
      await transport.close().catch(() => {});
    }

    const line = lines[0]!;
    expect(line.action).toBe('getControlSnapshot');
    expect(line.frame).toMatchObject({
      path: join(dir, 'exec', 'frame-1.png'),
      format: 'png',
      width: 800,
      height: 600,
      devicePixelRatio: 2,
      cssViewport: { width: 400, height: 300 },
      colorScheme: 'dark',
      lockstep: { verified: true, changedElements: 0 },
    });
    expect(Number.isNaN(Date.parse(line.frame!.capturedAt))).toBe(false);

    const elements = (line.result as { elements: El[] }).elements;
    const button = elements.find(
      (e) => e.bbox && Math.round(e.bbox.x) === 50 && Math.round(e.bbox.y) === 40
    );
    expect(button, JSON.stringify(elements.map((e) => [e.id, e.bbox]))).toBeDefined();
    const b = button!.bbox!;
    expect([b.width, b.height]).toEqual([100, 60]);

    const png = decodePng(readFileSync(line.frame!.path));
    expect([png.width, png.height]).toEqual([800, 600]);
    const s = line.frame!.devicePixelRatio;
    // The box's centre, mapped through the DPR, is the button: red.
    const cx = Math.round((b.x + b.width / 2) * s);
    const cy = Math.round((b.y + b.height / 2) * s);
    expect(png.px(cx, cy)).toEqual([255, 0, 0]);
    // Every corner of the scaled box is still inside the button.
    for (const [x, y] of [
      [b.x * s + 1, b.y * s + 1],
      [(b.x + b.width) * s - 2, b.y * s + 1],
      [b.x * s + 1, (b.y + b.height) * s - 2],
      [(b.x + b.width) * s - 2, (b.y + b.height) * s - 2],
    ] as const) {
      expect(png.px(Math.round(x), Math.round(y))).toEqual([255, 0, 0]);
    }
    // The UNSCALED box (CSS px read as frame px) is mostly the dark page:
    // its top-left at (50,40) is above and left of the scaled button (100,80).
    expect(png.px(Math.round(b.x), Math.round(b.y))).toEqual([0, 0, 0]);
  }, 90_000);

  it('--capture-matrix: one fresh context per cell, each pair stored with its provenance', async () => {
    const out = join(dir, 'matrix');
    const args = parseArgs([
      '--url',
      url,
      '--capture-matrix',
      out,
      '--viewport',
      '300x200',
      '--dpr',
      '1,2',
      '--color-scheme',
      'dark',
      '--quiet',
    ]);
    const seen: string[] = [];
    const manifest = await captureMatrix(
      args,
      [{ action: 'getControlSnapshot', payload: {} }],
      (report) => seen.push(`${report.id}:${report.status}`)
    );

    expect(seen).toEqual(['300x200_dpr1_dark:captured', '300x200_dpr2_dark:captured']);
    expect(manifest.kind).toBe('ui-bridge-capture-matrix');
    expect(manifest.url).toBe(url);
    expect(manifest.axes).toEqual({
      viewports: [{ width: 300, height: 200 }],
      dprs: [1, 2],
      colorSchemes: ['dark'],
    });
    expect(manifest.producer.version).toMatch(/^\d+\.\d+\.\d+/);

    for (const [i, dpr] of [1, 2].entries()) {
      const cell = manifest.cells[i]!;
      expect(cell.requested).toEqual({
        viewport: { width: 300, height: 200 },
        dpr,
        colorScheme: 'dark',
      });
      expect(cell.pairs).toHaveLength(1);
      const pair = cell.pairs[0]!;
      expect(pair.frame).toMatchObject({
        path: `${cell.id}/frame-1.png`,
        width: 300 * dpr,
        height: 200 * dpr,
        devicePixelRatio: dpr,
        cssViewport: { width: 300, height: 200 },
        colorScheme: 'dark',
        lockstep: { verified: true },
      });
      const png = decodePng(readFileSync(join(out, pair.frame!.path)));
      expect([png.width, png.height]).toEqual([300 * dpr, 200 * dpr]);
      const snapshot = JSON.parse(readFileSync(join(out, pair.snapshot), 'utf8')) as {
        elements: El[];
      };
      expect(snapshot.elements.length).toBeGreaterThan(0);
      expect(existsSync(join(out, cell.results!))).toBe(true);
    }

    // The manifest on disk is the one returned.
    expect(JSON.parse(readFileSync(join(out, 'matrix.json'), 'utf8'))).toEqual(
      JSON.parse(JSON.stringify(manifest))
    );

    // Owner-only on disk: frames are raw pixels data-bridge-redact never scrubs.
    if (process.platform !== 'win32') {
      const mode = (p: string) => statSync(p).mode & 0o777;
      expect(mode(out)).toBe(0o700);
      expect(mode(join(out, 'matrix.json'))).toBe(0o600);
      const cell = manifest.cells[0]!;
      expect(mode(join(out, cell.id))).toBe(0o700);
      expect(mode(join(out, cell.pairs[0]!.frame!.path))).toBe(0o600);
      expect(mode(join(out, cell.pairs[0]!.snapshot))).toBe(0o600);
      expect(mode(join(out, cell.results!))).toBe(0o600);
    }
  }, 120_000);
});
