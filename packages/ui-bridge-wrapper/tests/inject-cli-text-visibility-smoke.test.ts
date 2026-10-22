/**
 * Real Chromium: text hidden for frame B and restored exactly — Phase 16 of
 * plan 2026-10-13-image-generation-and-visual-judgment, end to end through the
 * functions the bin runs (`--exec 'textVisibility {"hidden":true}'`).
 *
 * What is proved in the pixels, not inferred:
 *   - frame B shows no glyph: white text over a hero image, a button label,
 *     gradient text (`background-clip: text`) and `::before` content all
 *     leave exactly the colour beneath them — and the text carries a 5 s
 *     colour transition, so a frame caught mid-fade would show it;
 *   - only glyphs change: a `currentColor` border and a `fill="currentColor"`
 *     icon keep their colour in frame B;
 *   - frame C (after the restore) is frame A pixel for pixel, though the
 *     restored text carries that same 5 s transition: it did not fade back in;
 *   - the DOM and every element's computed style read back identical.
 *
 * Gated on a Playwright Chromium being installed, as the other smokes are.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTransport } from '../src/create-transport.js';
import {
  SNAPSHOT_ACTIONS,
  buildTransportOptions,
  executeActions,
  parseArgs,
  registerFrameCapture,
  type ExecLine,
} from '../src/inject-cli.js';
import { chromiumAvailable } from '../../../test-support/chromium-gate.mjs';

const PLAYWRIGHT_AVAILABLE = chromiumAvailable();

/** A solid-colour 8-bit RGB PNG. */
function solidPng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => rgb[i % 3]!)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

interface Image {
  width: number;
  height: number;
  rgb(x: number, y: number): number[];
}

/** Decode an 8-bit RGB/RGBA PNG Chromium wrote. */
function decodePng(buf: Buffer): Image {
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const colorType = buf[25]!;
  const bpp = colorType === 6 ? 4 : 3;
  const idat: Buffer[] = [];
  for (let off = 8; off < buf.length; ) {
    const len = buf.readUInt32BE(off);
    if (buf.toString('ascii', off + 4, off + 8) === 'IDAT')
      idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const rows: Buffer[] = [];
  for (let r = 0; r < height; r++) {
    const filter = raw[r * (stride + 1)]!;
    const out = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const v = raw[r * (stride + 1) + 1 + i]!;
      const a = i >= bpp ? out[i - bpp]! : 0;
      const b = r > 0 ? rows[r - 1]![i]! : 0;
      const c = i >= bpp && r > 0 ? rows[r - 1]![i - bpp]! : 0;
      let p: number;
      if (filter === 0) p = v;
      else if (filter === 1) p = v + a;
      else if (filter === 2) p = v + b;
      else if (filter === 3) p = v + ((a + b) >> 1);
      else {
        const q = a + b - c;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - b);
        const pc = Math.abs(q - c);
        p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[i] = p & 0xff;
    }
    rows.push(out);
  }
  return {
    width,
    height,
    rgb: (x, y) => Array.from(rows[y]!.subarray(x * bpp, x * bpp + 3)),
  };
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** How many pixels in `box` differ from `rgb`. */
function offColour(img: Image, box: Box, rgb: number[]): number {
  let n = 0;
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const p = img.rgb(x, y);
      if (p[0] !== rgb[0] || p[1] !== rgb[1] || p[2] !== rgb[2]) n += 1;
    }
  }
  return n;
}

const GREEN = [0, 200, 0];
const WHITE = [255, 255, 255];
const HERO = solidPng(400, 100, [0, 200, 0]);

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>text</title>
<style>html,body{margin:0;background:#fff}
#hero{position:absolute;left:0;top:0;width:400px;height:100px}
#hero img{display:block;width:400px;height:100px}
#over{position:absolute;left:10px;top:20px;margin:0;color:#fff;font:bold 40px sans-serif;transition:color 5s linear}
#btn{position:absolute;left:10px;top:120px;width:120px;height:50px;box-sizing:border-box;padding:0;
  color:rgb(0,0,255);border:6px solid;background:transparent;font:bold 20px sans-serif;transition:color 5s linear}
#icon{position:absolute;left:200px;top:120px;color:rgb(255,0,0)}
#grad{position:absolute;left:200px;top:175px;margin:0;font:bold 40px sans-serif;
  background:linear-gradient(90deg,#f00,#00f);-webkit-background-clip:text;background-clip:text;
  -webkit-text-fill-color:transparent}
#pseudo{position:absolute;left:10px;top:190px;width:150px;height:40px}
#pseudo::before{content:"BEFORE";color:rgb(0,128,0);font:bold 24px sans-serif}
</style></head><body>
<div id="hero"><img src="/hero.png" alt="hero" data-ui-bridge-image-slot="hero"><h1 id="over" style="letter-spacing: 1px !important">Hello</h1></div>
<button id="btn">Go</button>
<svg id="icon" width="40" height="40"><rect width="40" height="40" fill="currentColor"/></svg>
<h2 id="grad">Grad</h2>
<div id="pseudo"></div>
</body></html>`;

/** Where each kind of text paints, and the colour beneath it. */
const TEXT_REGIONS: Array<{ name: string; box: Box; beneath: number[] }> = [
  {
    name: 'white text over the hero image',
    box: { x0: 10, y0: 20, x1: 250, y1: 90 },
    beneath: GREEN,
  },
  { name: 'the button label', box: { x0: 20, y0: 130, x1: 120, y1: 160 }, beneath: WHITE },
  { name: 'gradient text', box: { x0: 200, y0: 175, x1: 400, y1: 235 }, beneath: WHITE },
  { name: '::before content', box: { x0: 10, y0: 190, x1: 160, y1: 235 }, beneath: WHITE },
];

let server: Server;
let url: string;
let dir: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith('/hero.png')) {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(HERO);
    } else {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  dir = mkdtempSync(join(tmpdir(), 'inject-text-visibility-smoke-'));
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!PLAYWRIGHT_AVAILABLE)('text visibility (real Chromium)', () => {
  it('frame B shows no glyph and nothing else changed; the restore is exact and does not fade', async () => {
    const args = parseArgs([
      '--url',
      url,
      '--viewport',
      '400x240',
      '--exec',
      'getControlSnapshot {}',
      '--quiet',
    ]);
    const transport = createTransport({ kind: 'injected', options: buildTransportOptions(args) });
    registerFrameCapture(transport);
    type Page = { evaluate<R>(fn: () => R): Promise<R> };
    transport.register('__state', (_p: unknown, ctx: unknown) =>
      (ctx as { page: Page }).page.evaluate(() => ({
        dom: document.documentElement.outerHTML,
        computed: Array.from(document.body.querySelectorAll('*')).map((el) => {
          const cs = getComputedStyle(el);
          const out: Record<string, string> = {};
          for (let i = 0; i < cs.length; i++) out[cs.item(i)] = cs.getPropertyValue(cs.item(i));
          return out;
        }),
      }))
    );

    const lines: ExecLine[] = [];
    let before: unknown;
    let after: unknown;
    try {
      await transport.ready();
      before = await transport.dispatch('__state');
      const anyError = await executeActions(
        transport,
        [
          { action: 'getControlSnapshot', payload: {} },
          { action: 'textVisibility', payload: { hidden: true, ttlMs: 30_000 } },
          { action: 'getControlSnapshot', payload: {} },
          { action: 'textVisibility', payload: { hidden: false } },
          { action: 'getControlSnapshot', payload: {} },
        ],
        (position, action) =>
          SNAPSHOT_ACTIONS.has(action) ? join(dir, `frame-${position}.png`) : null,
        (line) => lines.push(line)
      );
      expect(anyError, JSON.stringify(lines.filter((l) => l.error))).toBe(false);
      after = await transport.dispatch('__state');
    } finally {
      await transport.close().catch(() => {});
    }

    const [snapA, hide, snapB, show, snapC] = lines;
    expect(hide!.result).toMatchObject({
      success: true,
      hidden: true,
      changed: true,
      coverage: { scope: 'document', backgroundClipText: 1 },
    });
    expect(show!.result).toMatchObject({
      success: true,
      hidden: false,
      changed: true,
      restore: { verified: true, propertyLevel: 0, drift: [] },
    });

    const a = decodePng(readFileSync(snapA!.frame!.path));
    const b = decodePng(readFileSync(snapB!.frame!.path));
    const c = decodePng(readFileSync(snapC!.frame!.path));

    // 1. Frame A shows each text; frame B shows only what is beneath it.
    for (const { name, box, beneath } of TEXT_REGIONS) {
      expect(offColour(a, box, beneath), `${name} visible in frame A`).toBeGreaterThan(20);
      expect(offColour(b, box, beneath), `${name} hidden in frame B`).toBe(0);
    }
    // 2. Only glyphs changed: the currentColor border and icon kept their colour.
    for (const img of [a, b]) {
      expect(img.rgb(12, 122)).toEqual([0, 0, 255]);
      expect(img.rgb(220, 140)).toEqual([255, 0, 0]);
    }
    // 3. Frame C is frame A, pixel for pixel: the 5 s transitions did not fade
    //    the text back in.
    let differing = 0;
    for (let y = 0; y < a.height; y++) {
      for (let x = 0; x < a.width; x++) {
        if (a.rgb(x, y).join() !== c.rgb(x, y).join()) differing += 1;
      }
    }
    expect(differing).toBe(0);
    // 4. The DOM and every computed style read back identical.
    expect(after).toEqual(before);
  }, 60_000);
});
